import type { AppRole } from "@/features/auth/roles";

import type { TicketState } from "./statuses";

/**
 * Legal status changes by role (master plan §6, P3.01). The database holds the authoritative
 * copy (private.ticket_transitions); an integration test fails if the two ever differ. This
 * copy only decides which controls to show: the database re-checks every request.
 */
export interface TransitionRule {
  readonly from: TicketState;
  readonly to: TicketState;
  readonly role: AppRole;
}

export const TRANSITION_RULES: readonly TransitionRule[] = [
  { from: "assigned", to: "in_progress", role: "department" },
  { from: "reopened", to: "in_progress", role: "department" },
  { from: "in_progress", to: "resolved", role: "department" },
  { from: "resolved", to: "closed", role: "student" },
  { from: "resolved", to: "reopened", role: "student" },
  { from: "assigned", to: "in_progress", role: "admin" },
  { from: "reopened", to: "in_progress", role: "admin" },
  { from: "in_progress", to: "resolved", role: "admin" },
  { from: "resolved", to: "closed", role: "admin" },
  { from: "resolved", to: "reopened", role: "admin" },
];

export function canTransition(from: TicketState, to: TicketState, role: AppRole): boolean {
  return TRANSITION_RULES.some(
    (rule) => rule.from === from && rule.to === to && rule.role === role,
  );
}

export function allowedTargets(from: TicketState, role: AppRole): readonly TicketState[] {
  return TRANSITION_RULES.filter((rule) => rule.from === from && rule.role === role).map(
    (rule) => rule.to,
  );
}

/** Changes that must explain themselves (enforced again in the database). */
export const NOTE_REQUIRED_FOR: readonly TicketState[] = ["resolved", "reopened"];

export const NOTE_LIMITS = { min: 5, max: 1000 } as const;

/** States from which an admin may (re)assign a ticket to a department. */
export const ASSIGNABLE_STATES: readonly TicketState[] = [
  "submitted",
  "triaging",
  "needs_review",
  "assigned",
  "in_progress",
  "reopened",
];

/** States in which the assigned department still has to confirm it has seen the ticket. */
export const ACKNOWLEDGEABLE_STATES: readonly TicketState[] = ["assigned", "reopened"];

/** Tickets waiting for a person to route them (the admin review queue, P3.07). */
export const AWAITING_ROUTING_STATES: readonly TicketState[] = [
  "submitted",
  "triaging",
  "needs_review",
];

/** Tickets a department still has to work on. */
export const DEPARTMENT_ACTIVE_STATES: readonly TicketState[] = [
  "assigned",
  "in_progress",
  "reopened",
];

export function canAcknowledge(
  ticket: { readonly status: TicketState; readonly acknowledgedAt: string | null },
  role: AppRole,
): boolean {
  return (
    role !== "student" &&
    ticket.acknowledgedAt === null &&
    ACKNOWLEDGEABLE_STATES.includes(ticket.status)
  );
}

export function canAddNote(status: TicketState, role: AppRole): boolean {
  return role !== "student" && status !== "closed";
}

export function canAssign(status: TicketState, role: AppRole): boolean {
  return role === "admin" && ASSIGNABLE_STATES.includes(status);
}

/** Button labels for each change, phrased from the point of view of the person acting. */
export const TRANSITION_LABELS: Readonly<Partial<Record<TicketState, string>>> = {
  in_progress: "Start work",
  resolved: "Mark resolved",
  closed: "Yes, it is fixed",
  reopened: "No, it is still a problem",
};

/**
 * An AI attempt that has held a ticket in "triaging" this long has stopped (its function ended
 * after committing the start). It matches the takeover threshold in agent_begin_run.
 */
export const TRIAGE_STALE_AFTER_MS = 2 * 60 * 1000;

export function isStalledTriage(
  ticket: { readonly status: TicketState; readonly updatedAt: string },
  nowMs: number,
): boolean {
  return (
    ticket.status === "triaging" && nowMs - Date.parse(ticket.updatedAt) >= TRIAGE_STALE_AFTER_MS
  );
}
