import { describe, expect, it, vi } from "vitest";

import { PROMPT_VERSION } from "@/features/agent/prompt";
import { AgentStoreError, type AgentStore, type FinishRunInput } from "@/features/agent/store";
import { triageTicket, type TriageDependencies } from "@/features/agent/triage";
import { createLogger } from "@/lib/logging/logger";

import {
  DEPARTMENTS,
  REPORT,
  ROUTE_ELECTRICAL,
  SNAPSHOT,
  propose,
  scriptedModel,
} from "../../../support/agent";

const TICKET = "7d2c1b9a-3e4f-4a5b-8c6d-0e1f2a3b4c5d";
const STUDENT = "a0000000-0000-4000-8000-00000000000a";

function fakeStore(overrides: Partial<AgentStore> = {}) {
  const finished: FinishRunInput[] = [];
  const spies = {
    beginRun: vi.fn<AgentStore["beginRun"]>(() =>
      Promise.resolve({ runId: "run-1", ticketVersion: 2, report: REPORT }),
    ),
    loadRoutingSnapshot: vi.fn<AgentStore["loadRoutingSnapshot"]>(() => Promise.resolve(SNAPSHOT)),
    finishRun: vi.fn<AgentStore["finishRun"]>((input) => {
      finished.push(input);
      return Promise.resolve({
        outcome: input.decision.kind === "route" ? "routed" : "needs_review",
        status: input.decision.kind === "route" ? "assigned" : "needs_review",
        version: 3,
      });
    }),
  };
  const store: AgentStore = { ...spies, ...overrides };
  return { store, spies, finished };
}

function deps(
  store: AgentStore,
  model: TriageDependencies["model"],
  lines: string[] = [],
): TriageDependencies {
  let clock = 1_000;
  return {
    store,
    model,
    modelName: "gemini-test",
    timeoutMs: 5_000,
    logger: createLogger({ level: "debug", sink: (_level, line) => lines.push(line) }),
    now: () => (clock += 250),
  };
}

const REQUEST = { ticketId: TICKET, trigger: "submission", requestedBy: STUDENT } as const;

describe("triageTicket", () => {
  it("claims the ticket, runs the agent and applies the approved route", async () => {
    const { store, spies, finished } = fakeStore();
    const { model } = scriptedModel([[ROUTE_ELECTRICAL], [propose()]]);

    const result = await triageTicket(deps(store, model), REQUEST);

    expect(result).toEqual({
      ok: true,
      runId: "run-1",
      outcome: "routed",
      status: "assigned",
      failureCode: undefined,
    });
    expect(spies.beginRun).toHaveBeenCalledWith({
      ...REQUEST,
      model: "gemini-test",
      promptVersion: PROMPT_VERSION,
    });
    expect(finished[0]).toMatchObject({
      runId: "run-1",
      expectedVersion: 2,
      decision: { kind: "route", departmentId: DEPARTMENTS.electrical.id },
    });
    expect(finished[0]?.durationMs).toBeGreaterThan(0);
  });

  it("records a missing API key as a failed attempt and sends the ticket to review", async () => {
    const { store, spies, finished } = fakeStore();

    const result = await triageTicket(deps(store, undefined), REQUEST);

    expect(result).toMatchObject({
      ok: true,
      outcome: "needs_review",
      failureCode: "PROVIDER_NOT_CONFIGURED",
    });
    expect(spies.loadRoutingSnapshot).not.toHaveBeenCalled();
    expect(finished[0]?.decision).toEqual({
      kind: "review",
      failureCode: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("does nothing more when the attempt cannot start (e.g. a replayed submission)", async () => {
    const { store, spies } = fakeStore({
      beginRun: () => Promise.reject(new AgentStoreError("CONFLICT")),
    });
    const { model, log } = scriptedModel([[propose()]]);

    expect(await triageTicket(deps(store, model), REQUEST)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(log.reportMessages).toHaveLength(0);
    expect(spies.finishRun).not.toHaveBeenCalled();
  });

  it("falls back to review when the database refuses a route the policy approved", async () => {
    let calls = 0;
    const { store, spies, finished } = fakeStore();
    const recordFinish = spies.finishRun.getMockImplementation();
    spies.finishRun.mockImplementation((input) => {
      calls += 1;
      return calls === 1 || recordFinish === undefined
        ? Promise.reject(new AgentStoreError("REFUSED"))
        : recordFinish(input);
    });
    const { model } = scriptedModel([[ROUTE_ELECTRICAL], [propose()]]);

    const result = await triageTicket(deps(store, model), REQUEST);

    expect(result).toMatchObject({
      ok: true,
      outcome: "needs_review",
      failureCode: "POLICY_REJECTED",
    });
    expect(finished[0]?.decision).toEqual({
      kind: "review",
      failureCode: "POLICY_REJECTED",
      proposal: {
        category: "electrical",
        departmentId: DEPARTMENTS.electrical.id,
        priority: "medium",
      },
    });
    expect(finished[0]?.trace.at(-1)).toMatchObject({
      tool: "agent_finish_run",
      verdict: "rejected",
    });
  });

  it("goes to review when routing data cannot be loaded", async () => {
    const { store } = fakeStore({
      loadRoutingSnapshot: () => Promise.reject(new AgentStoreError("UNAVAILABLE")),
    });
    const { model } = scriptedModel([[propose()]]);

    expect(await triageTicket(deps(store, model), REQUEST)).toMatchObject({
      ok: true,
      failureCode: "ROUTING_DATA_UNAVAILABLE",
    });
  });

  it("never throws when the result cannot be recorded; the ticket stays recoverable", async () => {
    const { store } = fakeStore({ finishRun: () => Promise.reject(new Error("socket hang up")) });
    const { model } = scriptedModel([[ROUTE_ELECTRICAL], [propose()]]);

    expect(await triageTicket(deps(store, model), REQUEST)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("reports a superseded run without claiming it routed anything", async () => {
    const { store } = fakeStore({
      finishRun: () => Promise.resolve({ outcome: "superseded", status: "assigned", version: 3 }),
    });
    const { model } = scriptedModel([[ROUTE_ELECTRICAL], [propose()]]);

    expect(await triageTicket(deps(store, model), REQUEST)).toMatchObject({
      ok: true,
      outcome: "superseded",
    });
  });

  it("logs ids, codes and tool names, never the report text", async () => {
    const { store } = fakeStore();
    const { model } = scriptedModel([[ROUTE_ELECTRICAL], [propose()]]);
    const lines: string[] = [];

    await triageTicket(deps(store, model, lines), REQUEST);

    const log = lines.join("\n");
    expect(log).toContain("agent.run_finished");
    expect(log).toContain("propose_assignment:accepted");
    expect(log).not.toContain(REPORT.description);
    expect(log).not.toContain("Corridor lighting has failed");
  });
});
