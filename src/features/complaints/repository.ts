import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import { encodeCursor, type PageCursor } from "./cursor";
import { complaintErrorFromDatabase } from "./errors";
import type { ComplaintInput } from "./schemas";
import { formatReference, type TicketPriority, type TicketState } from "./statuses";

type ComplaintRow = Database["public"]["Tables"]["complaints"]["Row"];
type EventRow = Database["public"]["Tables"]["ticket_events"]["Row"];
export type ComplaintCategoryValue = Database["public"]["Enums"]["complaint_category"];

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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimelineEvent {
  readonly id: number;
  readonly type: EventRow["event_type"];
  readonly actorKind: EventRow["actor_kind"];
  readonly previousStatus: TicketState | null;
  readonly newStatus: TicketState | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): TimelineEvent {
  return {
    id: row.id,
    type: row.event_type,
    actorKind: row.actor_kind,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
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
}

/** Keyset-paginated list of the tickets the caller may see (RLS decides which). */
export async function listComplaints(
  client: AppSupabaseClient,
  { limit, cursor, statuses }: ListOptions,
): Promise<ComplaintPage> {
  // One extra row tells us whether another page exists without a COUNT query.
  const { data, error } = await client.rpc("list_complaints", {
    p_limit: limit + 1,
    ...(cursor === undefined
      ? {}
      : { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id }),
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
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
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
    .select("*")
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
