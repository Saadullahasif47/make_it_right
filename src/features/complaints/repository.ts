import "server-only";

import type { AppRole } from "@/features/auth/roles";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import { encodeCursor, type PageCursor } from "./cursor";
import { complaintErrorFromDatabase } from "./errors";
import type { AssignInput, ComplaintInput, TransitionInput } from "./schemas";
import { formatReference, type TicketPriority, type TicketState } from "./statuses";
import type { TransitionRule } from "./workflow";

type ComplaintRow = Database["public"]["Tables"]["complaints"]["Row"];
type EventRow = Database["public"]["Tables"]["ticket_events"]["Row"];
export type ComplaintCategoryValue = Database["public"]["Enums"]["complaint_category"];
export type ListSort = "newest" | "oldest" | "priority";

export interface CreatedTicket {
  readonly id: string;
  readonly reference: string;
  readonly status: TicketState;
  /** False when the idempotency key had already been used: the original ticket is returned. */
  readonly created: boolean;
}

export interface ComplaintSummary {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly building: string;
  readonly room: string | null;
  readonly status: TicketState;
  readonly category: ComplaintCategoryValue;
  readonly priority: TicketPriority;
  readonly assignedDepartmentId: string | null;
  readonly acknowledgedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimelineEvent {
  readonly id: number;
  readonly type: EventRow["event_type"];
  readonly actorKind: EventRow["actor_kind"];
  readonly actorRole: AppRole | null;
  readonly previousStatus: TicketState | null;
  readonly newStatus: TicketState | null;
  readonly departmentName: string | null;
  readonly category: ComplaintCategoryValue | null;
  readonly priority: TicketPriority | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ComplaintDetail extends ComplaintSummary {
  readonly description: string;
  readonly version: number;
  readonly departmentName: string | null;
  readonly events: readonly TimelineEvent[];
}

export interface ComplaintPage {
  readonly items: readonly ComplaintSummary[];
  readonly nextCursor: string | null;
}

export interface TicketVersion {
  readonly id: string;
  readonly status: TicketState;
  readonly version: number;
}

export interface Department {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RoutingRule {
  readonly category: ComplaintCategoryValue;
  readonly departmentId: string;
  readonly enabled: boolean;
}

function toSummary(row: ComplaintRow): ComplaintSummary {
  return {
    id: row.id,
    reference: formatReference(row.reference_no),
    title: row.title,
    building: row.building,
    room: row.room,
    status: row.status,
    category: row.category,
    priority: row.priority,
    assignedDepartmentId: row.assigned_department_id,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow & { department: { name: string } | null }): TimelineEvent {
  return {
    id: row.id,
    type: row.event_type,
    actorKind: row.actor_kind,
    actorRole: row.actor_role,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    departmentName: row.department?.name ?? null,
    category: row.category,
    priority: row.priority,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Creates the ticket, its idempotency key and CREATED event in one database transaction. */
export async function createTicket(
  client: AppSupabaseClient,
  input: ComplaintInput,
  idempotencyKey: string,
): Promise<CreatedTicket> {
  const { data, error } = await client
    .rpc("create_ticket", {
      p_title: input.title,
      p_description: input.description,
      p_building: input.building,
      p_room: input.room ?? "",
      p_idempotency_key: idempotencyKey,
    })
    .single();

  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return {
    id: data.id,
    reference: formatReference(data.reference_no),
    status: data.status,
    created: data.created,
  };
}

export interface ListOptions {
  readonly limit: number;
  readonly cursor?: PageCursor | undefined;
  readonly statuses?: readonly TicketState[] | null | undefined;
  readonly sort?: ListSort | undefined;
}

/** Keyset-paginated list of the tickets the caller may see (RLS decides which). */
export async function listComplaints(
  client: AppSupabaseClient,
  { limit, cursor, statuses, sort = "newest" }: ListOptions,
): Promise<ComplaintPage> {
  // One extra row tells us whether another page exists without a COUNT query.
  const { data, error } = await client.rpc("list_complaints", {
    p_limit: limit + 1,
    p_sort: sort,
    ...(cursor === undefined
      ? {}
      : {
          p_cursor_created_at: cursor.createdAt,
          p_cursor_id: cursor.id,
          ...(cursor.priority === undefined ? {} : { p_cursor_priority: cursor.priority }),
        }),
    ...(statuses === null || statuses === undefined ? {} : { p_statuses: [...statuses] }),
  });

  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }

  const rows = data.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map(toSummary),
    nextCursor:
      data.length > limit && last !== undefined
        ? encodeCursor({
            createdAt: last.created_at,
            id: last.id,
            ...(sort === "priority" ? { priority: last.priority } : {}),
          })
        : null,
  };
}

/** One ticket with its timeline, or null when it does not exist or the caller may not see it. */
export async function getComplaint(
  client: AppSupabaseClient,
  id: string,
): Promise<ComplaintDetail | null> {
  const { data: row, error } = await client
    .from("complaints")
    .select("*, assigned_department:departments(name)")
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  if (row === null) {
    return null;
  }

  const { data: events, error: eventsError } = await client
    .from("ticket_events")
    .select("*, department:departments(name)")
    .eq("complaint_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (eventsError !== null) {
    throw complaintErrorFromDatabase(eventsError);
  }

  return {
    ...toSummary(row),
    description: row.description,
    version: row.version,
    departmentName: row.assigned_department?.name ?? null,
    events: events.map(toEvent),
  };
}

// ---------------------------------------------------------------------------------------------
// Workflow (Phase 3): each call is one audited, version-checked database function
// ---------------------------------------------------------------------------------------------

export async function transitionTicket(
  client: AppSupabaseClient,
  ticketId: string,
  input: TransitionInput,
): Promise<TicketVersion> {
  const { data, error } = await client
    .rpc("transition_ticket", {
      p_ticket_id: ticketId,
      p_target: input.target,
      p_expected_version: input.expectedVersion,
      ...(input.note === undefined ? {} : { p_note: input.note }),
    })
    .single();
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return { id: data.id, status: data.status, version: data.version };
}

export async function acknowledgeTicket(
  client: AppSupabaseClient,
  ticketId: string,
  expectedVersion: number,
): Promise<{ readonly id: string; readonly version: number }> {
  const { data, error } = await client
    .rpc("acknowledge_ticket", { p_ticket_id: ticketId, p_expected_version: expectedVersion })
    .single();
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return { id: data.id, version: data.version };
}

export async function addTicketNote(
  client: AppSupabaseClient,
  ticketId: string,
  note: string,
): Promise<void> {
  const { error } = await client.rpc("add_ticket_note", { p_ticket_id: ticketId, p_note: note });
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
}

export async function assignTicket(
  client: AppSupabaseClient,
  ticketId: string,
  input: AssignInput,
): Promise<TicketVersion> {
  const { data, error } = await client
    .rpc("assign_ticket", {
      p_ticket_id: ticketId,
      p_department_id: input.departmentId,
      p_category: input.category,
      p_priority: input.priority,
      p_expected_version: input.expectedVersion,
      ...(input.note === undefined ? {} : { p_note: input.note }),
    })
    .single();
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return { id: data.id, status: data.status, version: data.version };
}

export async function listTransitionRules(
  client: AppSupabaseClient,
): Promise<readonly TransitionRule[]> {
  const { data, error } = await client.rpc("ticket_transition_rules");
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return data.map((rule) => ({ from: rule.from_state, to: rule.to_state, role: rule.actor_role }));
}

export async function listActiveDepartments(
  client: AppSupabaseClient,
): Promise<readonly Department[]> {
  const { data, error } = await client
    .from("departments")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return data;
}

/** Admin-only by RLS; other roles receive an empty list. */
export async function listRoutingRules(client: AppSupabaseClient): Promise<readonly RoutingRule[]> {
  const { data, error } = await client
    .from("routing_rules")
    .select("category, department_id, enabled");
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return data.map((rule) => ({
    category: rule.category,
    departmentId: rule.department_id,
    enabled: rule.enabled,
  }));
}
