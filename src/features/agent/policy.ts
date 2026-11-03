import type { ComplaintCategory } from "@/features/complaints/categories";

import type { AgentFailureCode } from "./failures";
import { approvedRoute, type RoutingSnapshot } from "./routing";
import type { SafetyScreen } from "./safety";

export type ProposedPriority = "low" | "medium" | "high";

export interface Proposal {
  readonly category: ComplaintCategory;
  readonly departmentId: string;
  readonly priority: ProposedPriority;
  readonly reason: string;
}

export interface ApprovedRoute {
  readonly category: ComplaintCategory;
  readonly departmentId: string;
  readonly priority: "low" | "medium";
  readonly reason: string;
}

export type PolicyVerdict =
  | { readonly kind: "approve"; readonly route: ApprovedRoute }
  /** A correctable mistake: the model is told why and may try again within its step budget. */
  | { readonly kind: "retry"; readonly code: "DEPARTMENT_NOT_APPROVED"; readonly message: string }
  /** A human must decide. Final: the model gets no further say. */
  | { readonly kind: "review"; readonly code: AgentFailureCode };

/**
 * The server's routing policy (plan §8, BR-08). The model only proposes; this decides, and
 * agent_finish_run checks the same rules again in the database before anything is written.
 */
export function evaluateProposal(
  proposal: Proposal,
  snapshot: RoutingSnapshot,
  safety: SafetyScreen,
): PolicyVerdict {
  const route = approvedRoute(snapshot, proposal.category);
  if (route === undefined) {
    return { kind: "review", code: "NO_APPROVED_ROUTE" };
  }
  if (proposal.departmentId !== route.id) {
    return {
      kind: "retry",
      code: "DEPARTMENT_NOT_APPROVED",
      message: `That department is not the approved route for ${proposal.category}. Use the department_id returned by find_category_route.`,
    };
  }
  if (safety.flagged) {
    return { kind: "review", code: "SAFETY_REVIEW" };
  }
  if (proposal.priority === "high") {
    return { kind: "review", code: "HIGH_PRIORITY_REVIEW" };
  }
  return {
    kind: "approve",
    route: {
      category: proposal.category,
      departmentId: route.id,
      priority: proposal.priority,
      reason: proposal.reason,
    },
  };
}
