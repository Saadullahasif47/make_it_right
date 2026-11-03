import "server-only";

import type { TicketState } from "@/features/complaints/statuses";
import type { Logger } from "@/lib/logging/logger";

import type { AgentFailureCode } from "./failures";
import type { ModelClient } from "./model";
import { PROMPT_VERSION } from "./prompt";
import { runAgent, type AgentResult } from "./run-agent";
import {
  AgentStoreError,
  type AgentStore,
  type AgentStoreErrorCode,
  type RunTrigger,
} from "./store";
import type { ToolTraceEntry } from "./tools";

export interface TriageDependencies {
  readonly store: AgentStore;
  /** Undefined when AI is on but no API key is configured: the attempt is recorded as failed. */
  readonly model: ModelClient | undefined;
  readonly modelName: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly now?: () => number;
}

export interface TriageRequest {
  readonly ticketId: string;
  readonly trigger: RunTrigger;
  /** The verified session user behind this request (reporter, or the admin retrying). */
  readonly requestedBy: string;
}

export type TriageResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly outcome: "routed" | "needs_review" | "superseded";
      readonly status: TicketState;
      readonly failureCode: AgentFailureCode | undefined;
    }
  /** The attempt could not start, or could not be recorded; the ticket is still stored. */
  | { readonly ok: false; readonly code: AgentStoreErrorCode };

function review(failureCode: AgentFailureCode): AgentResult {
  return { decision: { kind: "review", failureCode }, trace: [], exchanges: 0, safetySignals: [] };
}

/**
 * One best-effort triage attempt after a ticket is durably stored (plan §4 steps 3-5):
 * claim the ticket, ask the model under one deadline, then apply the validated decision or
 * hand the ticket to a human. It never throws. If the process dies midway, the ticket stays
 * "triaging" and becomes retryable by an admin after two minutes (plan §4 step 7).
 */
export async function triageTicket(
  deps: TriageDependencies,
  request: TriageRequest,
): Promise<TriageResult> {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child({ complaintId: request.ticketId, trigger: request.trigger });

  let run;
  try {
    run = await deps.store.beginRun({
      ...request,
      model: deps.modelName,
      promptVersion: PROMPT_VERSION,
    });
  } catch (error) {
    const code = error instanceof AgentStoreError ? error.code : "UNAVAILABLE";
    log.warn("agent.run_not_started", { code });
    return { ok: false, code };
  }

  const started = now();
  let result: AgentResult;
  if (deps.model === undefined) {
    result = review("PROVIDER_NOT_CONFIGURED");
  } else {
    try {
      const snapshot = await deps.store.loadRoutingSnapshot();
      result = await runAgent({
        model: deps.model,
        snapshot,
        report: run.report,
        deadline: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (error) {
      log.error("agent.routing_data_unavailable", { error });
      result = review("ROUTING_DATA_UNAVAILABLE");
    }
  }

  let decision = result.decision;
  let trace: readonly ToolTraceEntry[] = result.trace;
  try {
    let finished;
    try {
      finished = await deps.store.finishRun({
        runId: run.runId,
        expectedVersion: run.ticketVersion,
        decision,
        trace,
        durationMs: now() - started,
      });
    } catch (error) {
      if (
        !(error instanceof AgentStoreError) ||
        error.code !== "REFUSED" ||
        decision.kind !== "route"
      ) {
        throw error;
      }
      // The database refused a route our policy approved (e.g. a rule changed meanwhile).
      // Nothing was written; record the refusal and hand the ticket to a human instead.
      decision = {
        kind: "review",
        failureCode: "POLICY_REJECTED",
        proposal: {
          category: decision.category,
          departmentId: decision.departmentId,
          priority: decision.priority,
        },
      };
      trace = [
        ...trace,
        {
          step: result.exchanges,
          tool: "agent_finish_run",
          verdict: "rejected",
          code: "POLICY_REJECTED",
        },
      ];
      finished = await deps.store.finishRun({
        runId: run.runId,
        expectedVersion: run.ticketVersion,
        decision,
        trace,
        durationMs: now() - started,
      });
    }

    const failureCode = decision.kind === "review" ? decision.failureCode : undefined;
    const { outcome } = finished;
    // Identifiers, codes and tool names only: complaint text never reaches the logs.
    log.info("agent.run_finished", {
      runId: run.runId,
      outcome,
      failureCode,
      durationMs: now() - started,
      exchanges: result.exchanges,
      tools: trace.map((entry) => `${entry.tool}:${entry.verdict}`),
      safetySignals: result.safetySignals,
    });
    return { ok: true, runId: run.runId, outcome, status: finished.status, failureCode };
  } catch (error) {
    // The ticket stays "triaging" and is recoverable by an admin retry after two minutes.
    log.error("agent.run_not_recorded", { runId: run.runId, error });
    return { ok: false, code: error instanceof AgentStoreError ? error.code : "UNAVAILABLE" };
  }
}
