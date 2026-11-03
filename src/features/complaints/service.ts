import "server-only";

import type { FieldErrors } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { ComplaintError, type ComplaintFailureCode } from "./errors";
import { createTicket, type CreatedTicket } from "./repository";
import { complaintInputSchema, idempotencyKeySchema } from "./schemas";
import type { TicketState } from "./statuses";

export type SubmitResult =
  | { readonly ok: true; readonly ticket: CreatedTicket }
  | { readonly ok: false; readonly code: ComplaintFailureCode; readonly fields?: FieldErrors };

export interface SubmitDependencies {
  readonly client: AppSupabaseClient;
  readonly logger: Logger;
  /**
   * The best-effort AI step (plan §4 steps 3-5), absent while AI is off. It runs only for a
   * newly created ticket and resolves to the ticket's status afterwards.
   */
  readonly triage?: ((ticketId: string) => Promise<TicketState | undefined>) | undefined;
}

export function firstIssuePerField(
  issues: readonly { path: PropertyKey[]; message: string }[],
): FieldErrors {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length === 0 ? "form" : String(issue.path[0]);
    fields[key] ??= issue.message;
  }
  return fields;
}

/**
 * The single "submit a complaint" use case, shared by the JSON API and the web form.
 * The ticket is stored first; the best-effort AI step runs only after that durable write and
 * can never turn a saved ticket into a failure. A replayed idempotency key returns the original
 * ticket without running AI again (plan §4 step 7).
 */
export async function submitComplaint(
  deps: SubmitDependencies,
  rawInput: unknown,
  rawIdempotencyKey: unknown,
): Promise<SubmitResult> {
  const input = complaintInputSchema.safeParse(rawInput);
  const key = idempotencyKeySchema.safeParse(rawIdempotencyKey);
  if (!input.success || !key.success) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      fields: {
        ...(input.success ? {} : firstIssuePerField(input.error.issues)),
        ...(key.success ? {} : { idempotencyKey: "A valid submission key is required." }),
      },
    };
  }

  let ticket: CreatedTicket;
  try {
    ticket = await createTicket(deps.client, input.data, key.data);
    // Identifiers only: complaint text never reaches the logs (plan §8, §11).
    deps.logger.info("complaint.submitted", { complaintId: ticket.id, created: ticket.created });
  } catch (error) {
    if (error instanceof ComplaintError) {
      deps.logger.warn("complaint.submit_rejected", { code: error.code });
      return { ok: false, code: error.code };
    }
    deps.logger.error("complaint.submit_failed", { error });
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }

  if (!ticket.created || deps.triage === undefined) {
    return { ok: true, ticket };
  }
  try {
    const status = await deps.triage(ticket.id);
    return { ok: true, ticket: status === undefined ? ticket : { ...ticket, status } };
  } catch (error) {
    // The triage contract is never to throw; if it does, the stored ticket still stands.
    deps.logger.error("complaint.triage_failed", { complaintId: ticket.id, error });
    return { ok: true, ticket };
  }
}
