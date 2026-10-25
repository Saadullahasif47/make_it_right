import "server-only";

import { isComplaintCategory, type ComplaintCategory } from "@/features/complaints/categories";
import type { TicketState } from "@/features/complaints/statuses";
import type { Json } from "@/lib/supabase/database.types";
import type { PrivilegedSupabaseClient } from "@/lib/supabase/privileged";

import type { RoutingSnapshot } from "./routing";
import type { AgentDecision, ToolTraceEntry } from "./tools";

export type RunTrigger = "submission" | "admin_retry";

export type AgentStoreErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  /** Already attempted, still in progress, or the run already finished. */
  | "CONFLICT"
  /** Not awaiting routing, or the decision broke the database's routing policy. */
  | "REFUSED"
  | "RETRY_LIMIT"
  | "UNAVAILABLE";

export class AgentStoreError extends Error {
  override readonly name = "AgentStoreError";
  readonly code: AgentStoreErrorCode;

  constructor(code: AgentStoreErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }
}

function storeError(error: { readonly code?: string }): AgentStoreError {
  switch (error.code) {
    case "MR403":
      return new AgentStoreError("FORBIDDEN", { cause: error });
    case "MR404":
      return new AgentStoreError("NOT_FOUND", { cause: error });
    case "MR409":
      return new AgentStoreError("CONFLICT", { cause: error });
    case "MR422":
    case "22023":
    case "23514":
      return new AgentStoreError("REFUSED", { cause: error });
    case "MR429":
      return new AgentStoreError("RETRY_LIMIT", { cause: error });
    case undefined: // network failure: no SQLSTATE at all
    default:
      return new AgentStoreError("UNAVAILABLE", { cause: error });
  }
}

export interface StartedRun {
  readonly runId: string;
  readonly ticketVersion: number;
  readonly report: { readonly title: string; readonly description: string };
}

export interface FinishedRun {
  readonly outcome: "routed" | "needs_review" | "superseded";
  readonly status: TicketState;
  readonly version: number;
}

export interface FinishRunInput {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly decision: AgentDecision;
  readonly trace: readonly ToolTraceEntry[];
  readonly durationMs: number;
}

/** The agent's only access to the database: the two privileged functions and reference data. */
export interface AgentStore {
  beginRun(input: {
    readonly ticketId: string;
    readonly trigger: RunTrigger;
    readonly requestedBy: string;
    readonly model: string;
    readonly promptVersion: string;
  }): Promise<StartedRun>;
  finishRun(input: FinishRunInput): Promise<FinishedRun>;
  loadRoutingSnapshot(): Promise<RoutingSnapshot>;
}

function traceToJson(trace: readonly ToolTraceEntry[]): Json {
  return trace.map((entry) => {
    const row: Record<string, string | number> = {
      step: entry.step,
      tool: entry.tool,
      verdict: entry.verdict,
    };
    if (entry.code !== undefined) row.code = entry.code;
    if (entry.category !== undefined) row.category = entry.category;
    if (entry.departmentId !== undefined) row.departmentId = entry.departmentId;
    if (entry.priority !== undefined) row.priority = entry.priority;
    return row;
  });
}

export function createAgentStore(client: PrivilegedSupabaseClient): AgentStore {
  return {
    async beginRun({ ticketId, trigger, requestedBy, model, promptVersion }) {
      const { data, error } = await client
        .rpc("agent_begin_run", {
          p_ticket_id: ticketId,
          p_trigger: trigger,
          p_requested_by: requestedBy,
          p_model: model,
          p_prompt_version: promptVersion,
        })
        .single();
      if (error !== null) {
        throw storeError(error);
      }
      return {
        runId: data.run_id,
        ticketVersion: data.ticket_version,
        report: { title: data.title, description: data.description },
      };
    },

    async finishRun({ runId, expectedVersion, decision, trace, durationMs }) {
      const shared = {
        p_run_id: runId,
        p_expected_version: expectedVersion,
        p_tool_calls: traceToJson(trace),
        p_duration_ms: Math.max(0, Math.round(durationMs)),
      };
      const args =
        decision.kind === "route"
          ? {
              ...shared,
              p_outcome: "routed" as const,
              p_category: decision.category,
              p_department_id: decision.departmentId,
              p_priority: decision.priority,
              p_reason: decision.reason,
            }
          : {
              ...shared,
              p_outcome: "needs_review" as const,
              p_failure_code: decision.failureCode,
              ...(decision.proposal?.category === undefined
                ? {}
                : { p_category: decision.proposal.category }),
              ...(decision.proposal?.departmentId === undefined
                ? {}
                : { p_department_id: decision.proposal.departmentId }),
              ...(decision.proposal?.priority === undefined
                ? {}
                : { p_priority: decision.proposal.priority }),
            };

      const { data, error } = await client.rpc("agent_finish_run", args).single();
      if (error !== null) {
        throw storeError(error);
      }
      if (data.outcome === "running") {
        throw new AgentStoreError("UNAVAILABLE");
      }
      return { outcome: data.outcome, status: data.status, version: data.version };
    },

    async loadRoutingSnapshot() {
      const [departments, rules] = await Promise.all([
        client.from("departments").select("id, code, name").eq("is_active", true).order("name"),
        client.from("routing_rules").select("category, department_id").eq("enabled", true),
      ]);
      if (departments.error !== null || rules.error !== null) {
        throw new AgentStoreError("UNAVAILABLE", { cause: departments.error ?? rules.error });
      }
      const active = new Set(departments.data.map((department) => department.id));
      const routes = new Map<ComplaintCategory, string>();
      for (const rule of rules.data) {
        if (isComplaintCategory(rule.category) && active.has(rule.department_id)) {
          routes.set(rule.category, rule.department_id);
        }
      }
      return { departments: departments.data, routes };
    },
  };
}
