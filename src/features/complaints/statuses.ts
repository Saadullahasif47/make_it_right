import type { Database } from "@/lib/supabase/database.types";

export type TicketState = Database["public"]["Enums"]["ticket_state"];
export type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

/** Lifecycle order (plan §6). `satisfies` fails to compile if the database enum drifts. */
export const TICKET_STATES = [
  "submitted",
  "triaging",
  "needs_review",
  "assigned",
  "in_progress",
  "resolved",
  "reopened",
  "closed",
] as const satisfies readonly TicketState[];

export const STATUS_LABELS: Readonly<Record<TicketState, string>> = {
  submitted: "Submitted",
  triaging: "Being routed",
  needs_review: "Awaiting review",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  reopened: "Reopened",
  closed: "Closed",
};

export type StatusTone = "neutral" | "attention" | "active" | "done" | "warning";

/** Visual grouping only; the meaning of a state lives in the database and domain rules. */
export const STATUS_TONES: Readonly<Record<TicketState, StatusTone>> = {
  submitted: "neutral",
  triaging: "neutral",
  needs_review: "attention",
  assigned: "active",
  in_progress: "active",
  resolved: "done",
  reopened: "warning",
  closed: "done",
};

export const PRIORITY_LABELS: Readonly<Record<TicketPriority, string>> = {
  unassessed: "Not yet assessed",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Filters offered to students; each maps to a set of states. */
export const STATUS_FILTERS = {
  all: { label: "All", states: null },
  open: {
    label: "Open",
    states: ["submitted", "triaging", "needs_review", "assigned", "in_progress", "reopened"],
  },
  resolved: { label: "Resolved", states: ["resolved"] },
  closed: { label: "Closed", states: ["closed"] },
} as const satisfies Record<string, { label: string; states: readonly TicketState[] | null }>;

export type StatusFilter = keyof typeof STATUS_FILTERS;

export const STATUS_FILTER_ORDER: readonly StatusFilter[] = ["all", "open", "resolved", "closed"];

export function isStatusFilter(value: unknown): value is StatusFilter {
  return typeof value === "string" && Object.hasOwn(STATUS_FILTERS, value);
}

export function formatReference(referenceNo: number): string {
  return `MIR-${referenceNo}`;
}
