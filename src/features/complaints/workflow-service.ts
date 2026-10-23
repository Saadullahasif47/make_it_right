import "server-only";

import type { FieldErrors } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { ComplaintError, type ComplaintFailureCode } from "./errors";
import {
  acknowledgeTicket,
  addTicketNote,
  assignTicket,
  transitionTicket,
  type TicketVersion,
} from "./repository";
import {
  acknowledgeInputSchema,
  assignInputSchema,
  complaintIdSchema,
  noteInputSchema,
  transitionInputSchema,
} from "./schemas";
import { firstIssuePerField } from "./service";

export type WorkflowResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ComplaintFailureCode; readonly fields?: FieldErrors };

export interface WorkflowDependencies {
  readonly client: AppSupabaseClient;
  readonly logger: Logger;
}

interface Parser<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/**
 * Validates the ticket id and input, runs one audited database function, and turns every
 * failure into a stable code. Logs carry identifiers and outcomes only, never note text.
 */
async function run<Input, Output>(
  deps: WorkflowDependencies,
  operation: string,
  rawTicketId: unknown,
  rawInput: unknown,
  parser: Parser<Input>,
  execute: (ticketId: string, input: Input) => Promise<Output>,
): Promise<WorkflowResult<Output>> {
  const ticketId = complaintIdSchema.safeParse(rawTicketId);
  if (!ticketId.success) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const input = parser.safeParse(rawInput);
  if (!input.success) {
    return { ok: false, code: "VALIDATION_FAILED", fields: firstIssuePerField(input.error.issues) };
  }

  try {
    const value = await execute(ticketId.data, input.data);
    deps.logger.info(`complaint.${operation}`, { complaintId: ticketId.data });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ComplaintError) {
      deps.logger.warn(`complaint.${operation}_rejected`, {
        complaintId: ticketId.data,
        code: error.code,
      });
      return { ok: false, code: error.code };
    }
    deps.logger.error(`complaint.${operation}_failed`, { complaintId: ticketId.data, error });
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
}

/** Moves a ticket along the lifecycle (start work, resolve, close, reopen). */
export function changeStatus(
  deps: WorkflowDependencies,
  ticketId: unknown,
  rawInput: unknown,
): Promise<WorkflowResult<TicketVersion>> {
  return run(deps, "status_changed", ticketId, rawInput, transitionInputSchema, (id, input) =>
    transitionTicket(deps.client, id, input),
  );
}

export function acknowledge(
  deps: WorkflowDependencies,
  ticketId: unknown,
  rawInput: unknown,
): Promise<WorkflowResult<{ readonly id: string; readonly version: number }>> {
  return run(deps, "acknowledged", ticketId, rawInput, acknowledgeInputSchema, (id, input) =>
    acknowledgeTicket(deps.client, id, input.expectedVersion),
  );
}

export function addNote(
  deps: WorkflowDependencies,
  ticketId: unknown,
  rawInput: unknown,
): Promise<WorkflowResult<null>> {
  return run(deps, "note_added", ticketId, rawInput, noteInputSchema, async (id, input) => {
    await addTicketNote(deps.client, id, input.note);
    return null;
  });
}

/** Admin classification and (re)assignment to a department. */
export function assign(
  deps: WorkflowDependencies,
  ticketId: unknown,
  rawInput: unknown,
): Promise<WorkflowResult<TicketVersion>> {
  return run(deps, "assigned", ticketId, rawInput, assignInputSchema, (id, input) =>
    assignTicket(deps.client, id, input),
  );
}
