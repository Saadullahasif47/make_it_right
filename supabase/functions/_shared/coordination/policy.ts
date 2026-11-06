import { screenForSafety } from "../text/safety.ts";

import { reportText, type ApprovedRoute, type CaseContext } from "./context.ts";

/** A department with this many open work orders gets a person's look before more arrive. */
export const OVERLOAD_THRESHOLD = 10;
/** Three cases of the same equipment within 30 days is a repeat failure (plan F6 REPEAT_30D). */
export const REPEAT_FAILURE_CASES = 3;

export interface Proposal {
  readonly departmentId: string;
  readonly category: string;
  readonly priority: string;
  readonly rationale: string;
}

/**
 * Whether a proposal names an approved route at all (F3.03 "validated by department matrix").
 * A refusal is explained to the model, which may correct itself within its budget.
 */
export function checkRoute(
  proposal: Proposal,
  routes: readonly ApprovedRoute[],
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly approved?: ApprovedRoute } {
  const approved = routes.find((route) => route.category === proposal.category);
  if (approved === undefined) {
    return { ok: false, reason: `No department is approved for ${proposal.category}.` };
  }
  if (approved.department_id !== proposal.departmentId) {
    return {
      ok: false,
      reason: `Only ${approved.department} (${approved.department_id}) is approved for ${proposal.category}.`,
      approved,
    };
  }
  return { ok: true };
}

export interface PolicyFacts {
  readonly context: CaseContext;
  readonly proposal: Proposal;
  /** Open work orders of the proposed department. */
  readonly departmentLoad: number;
  /** Cases of the case's equipment opened in the last 30 days, this one included. */
  readonly recentAssetCases: number;
}

/**
 * Deterministic approval policy (F3.04, plan §08: "If low risk + deterministic policy permits:
 * commit once. Otherwise: request admin approval"). Every reason here sends the proposal to a
 * person; the model's opinion of its own risk is never asked. The database re-checks the
 * priority rule and the route when it records the run.
 */
export function approvalReasons(facts: PolicyFacts): readonly string[] {
  const { context, proposal } = facts;
  const reasons: string[] = [];
  if (proposal.priority === "high" || context.priority === "high") reasons.push("HIGH_PRIORITY");
  if (screenForSafety(reportText(context)).flagged) reasons.push("SAFETY_SIGNAL");
  if (facts.recentAssetCases >= REPEAT_FAILURE_CASES) reasons.push("REPEAT_FAILURE");
  if (facts.departmentLoad >= OVERLOAD_THRESHOLD) reasons.push("DEPARTMENT_OVERLOADED");
  if (context.department !== null && context.department.department_id !== proposal.departmentId) {
    reasons.push("REASSIGNMENT");
  }
  if (context.category !== "unclassified" && context.category !== proposal.category) {
    reasons.push("CATEGORY_CHANGE");
  }
  if (context.report_count > 1) reasons.push("SHARED_CASE");
  return reasons;
}
