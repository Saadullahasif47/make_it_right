/** Plain-language labels for the coordinator's trace, outcomes and approval reasons (F3.04-F3.05). */

import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import { PRIORITY_LABELS } from "@/features/complaints/statuses";

/** Labels for values read back from the database as plain strings. */
export function priorityLabel(priority: string): string {
  return priority in PRIORITY_LABELS
    ? PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS]
    : priority;
}

export function categoryLabel(category: string): string {
  return isComplaintCategory(category) ? CATEGORY_LABELS[category] : category;
}

export const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_case_context: "Read the case again",
  get_asset_repair_history: "Read the equipment's repair history",
  get_department_capacity: "Checked a department's open work orders",
  find_related_cases: "Looked for related cases in the room",
  propose_work_order: "Proposed a work order",
  request_admin_review: "Asked for an administrator",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? `Asked for a tool that does not exist (${tool})`;
}

export const VERDICT_LABELS: Readonly<Record<string, string>> = {
  ok: "done",
  proposal: "proposed",
  review: "handed to a person",
  unknown_tool: "refused: no such tool",
  invalid_args: "refused: malformed request",
  out_of_scope: "refused: outside this case",
  policy_rejected: "refused: not the approved department",
  read_budget_exhausted: "refused: no reads left",
  not_found: "nothing found",
};

/** Verdicts that mean the model tried something it may not do. */
export const UNAUTHORISED_VERDICTS = new Set(["unknown_tool", "out_of_scope"]);

export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  committed: "Work order created (low risk, approved by policy)",
  awaiting_approval: "Proposed a work order that needs approval",
  review_requested: "Handed to a person",
  superseded: "Not used: the case changed while it ran",
};

export const REASON_LABELS: Readonly<Record<string, string>> = {
  HIGH_PRIORITY: "High priority",
  SAFETY_SIGNAL: "The reports mention a possible hazard",
  REPEAT_FAILURE: "This equipment had 3 or more cases in 30 days",
  DEPARTMENT_OVERLOADED: "The department already has 10 or more open work orders",
  REASSIGNMENT: "It would move the case to another department",
  CATEGORY_CHANGE: "It would change the case's category",
  SHARED_CASE: "The case covers several reports",
  MODEL_AMBIGUOUS: "The coordinator found the reports ambiguous",
  MODEL_HAZARD: "The coordinator saw a possible hazard",
  MODEL_CONTRADICTORY_EVIDENCE: "The reports contradict each other",
  MODEL_NO_SUITABLE_DEPARTMENT: "No approved department fits",
  MODEL_OTHER: "The coordinator asked for a person",
  STEP_LIMIT: "The coordinator used all its steps without deciding",
  INVALID_OUTPUT: "The coordinator's answer was not usable",
  POLICY_REJECTED: "The proposal named a department that is not the approved route",
  CASE_CHANGED: "The case changed while the coordinator worked",
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  ticket_routing: "routed on the ticket",
  coordinator: "by the AI coordinator (low risk)",
  admin_approved: "proposed by the AI coordinator, approved by an administrator",
};
