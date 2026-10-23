import "server-only";

import type { FieldErrors } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { ComplaintError, type ComplaintFailureCode } from "./errors";
import { createTicket, type CreatedTicket } from "./repository";
import { complaintInputSchema, idempotencyKeySchema } from "./schemas";

export type SubmitResult =
  | { readonly ok: true; readonly ticket: CreatedTicket }
  | { readonly ok: false; readonly code: ComplaintFailureCode; readonly fields?: FieldErrors };

export interface SubmitDependencies {
  readonly client: AppSupabaseClient;
  readonly logger: Logger;
}

function firstIssuePerField(
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
 * Persistence is the whole job in Phase 2; the best-effort AI step is added after the
 * durable write in Phase 4 and can never turn a saved ticket into a failure.
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

  try {
    const ticket = await createTicket(deps.client, input.data, key.data);
    // Identifiers only: complaint text never reaches the logs (plan §8, §11).
    deps.logger.info("complaint.submitted", { complaintId: ticket.id, created: ticket.created });
    return { ok: true, ticket };
  } catch (error) {
    if (error instanceof ComplaintError) {
      deps.logger.warn("complaint.submit_rejected", { code: error.code });
      return { ok: false, code: error.code };
    }
    deps.logger.error("complaint.submit_failed", { error });
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
}
