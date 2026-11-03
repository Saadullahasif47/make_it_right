import type { ModelClient, ModelTurn, ToolResult } from "@/features/agent/model";
import type { RoutingSnapshot } from "@/features/agent/routing";
import type { ToolCall } from "@/features/agent/tools";

export const DEPARTMENTS = {
  electrical: {
    id: "0b5f3c1e-6a43-4c0e-9d2b-1f6a7e3c4d01",
    code: "electrical",
    name: "Electrical Maintenance",
  },
  plumbing: { id: "0b5f3c1e-6a43-4c0e-9d2b-1f6a7e3c4d02", code: "plumbing", name: "Plumbing" },
  facilities: {
    id: "0b5f3c1e-6a43-4c0e-9d2b-1f6a7e3c4d03",
    code: "facilities",
    name: "Facilities Office",
  },
} as const;

/** Electrical, plumbing and other have routes; the remaining categories deliberately do not. */
export const SNAPSHOT: RoutingSnapshot = {
  departments: Object.values(DEPARTMENTS),
  routes: new Map([
    ["electrical", DEPARTMENTS.electrical.id],
    ["plumbing", DEPARTMENTS.plumbing.id],
    ["other", DEPARTMENTS.facilities.id],
  ]),
};

export const FABRICATED_DEPARTMENT = "9f9f9f9f-1111-4222-8333-444455556666";

export function call(name: string, args: Record<string, unknown> = {}, id?: string): ToolCall {
  return { id, name, args };
}

export const ROUTE_ELECTRICAL = call("find_category_route", { category: "electrical" });

export function propose(overrides: Record<string, unknown> = {}): ToolCall {
  return call("propose_assignment", {
    category: "electrical",
    department_id: DEPARTMENTS.electrical.id,
    priority: "medium",
    reason: "Corridor lighting has failed.",
    ...overrides,
  });
}

/** What a scripted model saw on each turn, for assertions. */
export interface ScriptLog {
  readonly reportMessages: string[];
  readonly resultsPerTurn: (readonly ToolResult[])[];
}

/**
 * A model that plays back fixed turns. A turn may be an Error (thrown by `send`) or a function
 * of the deadline, for timeout tests.
 */
export function scriptedModel(
  turns: readonly (readonly ToolCall[] | Error | ((deadline: AbortSignal) => Promise<ModelTurn>))[],
): { model: ModelClient; log: ScriptLog } {
  const log: ScriptLog = { reportMessages: [], resultsPerTurn: [] };
  const model: ModelClient = {
    model: "scripted-model",
    startConversation(reportMessage) {
      log.reportMessages.push(reportMessage);
      let index = 0;
      return {
        send(results, deadline) {
          log.resultsPerTurn.push(results);
          const turn = turns[index++];
          if (turn === undefined) {
            return Promise.resolve({ calls: [] });
          }
          if (turn instanceof Error) {
            return Promise.reject(turn);
          }
          if (typeof turn === "function") {
            return turn(deadline);
          }
          return Promise.resolve({ calls: turn });
        },
      };
    },
  };
  return { model, log };
}

export const REPORT = {
  title: "Corridor lights out",
  description: "All the ceiling lights in the second floor corridor of Block C are off.",
};

export function liveDeadline(): AbortSignal {
  return new AbortController().signal;
}
