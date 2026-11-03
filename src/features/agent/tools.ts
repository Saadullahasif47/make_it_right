import { z } from "zod";

import { COMPLAINT_CATEGORIES, type ComplaintCategory } from "@/features/complaints/categories";

import type { AgentFailureCode } from "./failures";
import { evaluateProposal, type ApprovedRoute, type ProposedPriority } from "./policy";
import { approvedRoute, type RoutingSnapshot } from "./routing";
import type { SafetyScreen } from "./safety";
import { sanitizeReason } from "./sanitize";

export const TOOL_NAMES = [
  "list_departments",
  "find_category_route",
  "propose_assignment",
  "request_human_review",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const PROPOSABLE_PRIORITIES = ["low", "medium", "high"] as const;
export const REVIEW_REASONS = [
  "ambiguous",
  "not_maintenance",
  "insufficient_detail",
  "safety_concern",
  "other",
] as const;
export const REASON_LIMITS = { min: 5, max: 280 } as const;

/** Tool arguments are untrusted model output: strict schemas, unknown keys refused. */
const routeQuerySchema = z.strictObject({ category: z.enum(COMPLAINT_CATEGORIES) });
const proposalSchema = z.strictObject({
  category: z.enum(COMPLAINT_CATEGORIES),
  department_id: z.uuid(),
  priority: z.enum(PROPOSABLE_PRIORITIES),
  reason: z.string().trim().min(REASON_LIMITS.min).max(REASON_LIMITS.max),
});
const reviewRequestSchema = z.object({ reason: z.enum(REVIEW_REASONS).catch("other") });

export interface ToolCall {
  /** Provider call id, echoed back with the result when the provider supplies one. */
  readonly id: string | undefined;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * One line of the audit trace stored on agent_runs. It holds enum and id arguments only:
 * never the model's free text, never complaint text (plan §8).
 */
export interface ToolTraceEntry {
  readonly step: number;
  readonly tool: string;
  readonly verdict: "ok" | "rejected" | "accepted" | "review";
  readonly code?: string;
  readonly category?: ComplaintCategory;
  readonly departmentId?: string;
  readonly priority?: ProposedPriority;
}

export interface ProposalSummary {
  readonly category?: ComplaintCategory;
  readonly departmentId?: string;
  readonly priority?: ProposedPriority;
}

export type AgentDecision =
  | ({ readonly kind: "route" } & ApprovedRoute)
  | {
      readonly kind: "review";
      readonly failureCode: AgentFailureCode;
      readonly proposal?: ProposalSummary;
    };

export type ToolOutcome =
  | {
      readonly kind: "continue";
      readonly response: Record<string, unknown>;
      readonly trace: ToolTraceEntry;
    }
  | { readonly kind: "final"; readonly decision: AgentDecision; readonly trace: ToolTraceEntry };

export interface ToolContext {
  readonly snapshot: RoutingSnapshot;
  readonly safety: SafetyScreen;
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function rejected(step: number, tool: string, code: string, error: string): ToolOutcome {
  return {
    kind: "continue",
    response: { ok: false, error },
    trace: { step, tool, verdict: "rejected", code },
  };
}

/**
 * Executes one model tool call against the routing snapshot. Read tools answer from approved
 * data only; propose_assignment goes through the routing policy. Nothing here writes anywhere:
 * a final decision is applied later by the privileged adapter, and re-checked in SQL.
 */
export function executeTool(call: ToolCall, step: number, context: ToolContext): ToolOutcome {
  const tool = call.name.slice(0, 64);
  if (!isToolName(call.name)) {
    return rejected(step, tool, "UNKNOWN_TOOL", "Unknown tool. Use only the declared tools.");
  }

  switch (call.name) {
    case "list_departments":
      return {
        kind: "continue",
        response: {
          ok: true,
          departments: context.snapshot.departments.map(({ id, name }) => ({ id, name })),
        },
        trace: { step, tool, verdict: "ok" },
      };

    case "find_category_route": {
      const query = routeQuerySchema.safeParse(call.args);
      if (!query.success) {
        return rejected(
          step,
          tool,
          "INVALID_ARGUMENTS",
          `category must be one of: ${COMPLAINT_CATEGORIES.join(", ")}.`,
        );
      }
      const route = approvedRoute(context.snapshot, query.data.category);
      return {
        kind: "continue",
        response:
          route === undefined
            ? {
                ok: true,
                category: query.data.category,
                department: null,
                note: "No automatic route: request human review.",
              }
            : {
                ok: true,
                category: query.data.category,
                department: { id: route.id, name: route.name },
              },
        trace: { step, tool, verdict: "ok", category: query.data.category },
      };
    }

    case "propose_assignment": {
      const parsed = proposalSchema.safeParse(call.args);
      if (!parsed.success) {
        return rejected(
          step,
          tool,
          "INVALID_ARGUMENTS",
          "Arguments must be: category (a listed category), department_id (an id from find_category_route), priority (low, medium or high) and reason (5 to 280 characters).",
        );
      }
      const { category, department_id: departmentId, priority, reason } = parsed.data;
      const summary = { category, departmentId, priority };
      const verdict = evaluateProposal(
        { category, departmentId, priority, reason: sanitizeReason(reason) },
        context.snapshot,
        context.safety,
      );
      switch (verdict.kind) {
        case "approve":
          return {
            kind: "final",
            decision: { kind: "route", ...verdict.route },
            trace: { step, tool, verdict: "accepted", ...summary },
          };
        case "retry":
          return {
            kind: "continue",
            response: { ok: false, error: verdict.message },
            trace: { step, tool, verdict: "rejected", code: verdict.code, ...summary },
          };
        case "review":
          return {
            kind: "final",
            decision: { kind: "review", failureCode: verdict.code, proposal: summary },
            trace: { step, tool, verdict: "review", code: verdict.code, ...summary },
          };
      }
    }

    case "request_human_review": {
      const { reason } = reviewRequestSchema.parse(call.args);
      return {
        kind: "final",
        decision: { kind: "review", failureCode: "MODEL_REQUESTED_REVIEW" },
        trace: { step, tool, verdict: "review", code: `MODEL_${reason.toUpperCase()}` },
      };
    }
  }
}
