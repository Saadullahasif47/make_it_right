import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { complaintIdSchema } from "@/features/complaints/schemas";
import type { TicketState } from "@/features/complaints/statuses";
import type { ApiErrorCode } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";

import type { AgentFailureCode } from "./failures";
import type { TriageRunner } from "./instance";
import type { AgentStoreErrorCode } from "./store";

export type RetryFailureCode = Extract<
  ApiErrorCode,
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "AI_DISABLED"
  | "AI_IN_PROGRESS"
  | "AI_RETRY_LIMIT"
  | "INVALID_TRANSITION"
  | "SERVICE_UNAVAILABLE"
>;

export type RetryResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly outcome: "routed" | "needs_review" | "superseded";
        readonly status: TicketState;
        readonly failureCode: AgentFailureCode | null;
      };
    }
  | { readonly ok: false; readonly code: RetryFailureCode };

const STORE_FAILURES: Readonly<Record<AgentStoreErrorCode, RetryFailureCode>> = {
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "AI_IN_PROGRESS",
  REFUSED: "INVALID_TRANSITION",
  RETRY_LIMIT: "AI_RETRY_LIMIT",
  UNAVAILABLE: "SERVICE_UNAVAILABLE",
};

/**
 * An administrator's bounded retry of the AI step (plan §11 retry-ai, P4.08). The session role
 * is checked here and again by agent_begin_run from the database, with the per-ticket and
 * per-admin limits enforced there, durably.
 */
export async function retryTriage(
  deps: { readonly run: TriageRunner | undefined; readonly logger: Logger },
  actor: SessionUser,
  rawTicketId: unknown,
): Promise<RetryResult> {
  if (actor.role !== "admin") {
    return { ok: false, code: "FORBIDDEN" };
  }
  const ticketId = complaintIdSchema.safeParse(rawTicketId);
  if (!ticketId.success) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (deps.run === undefined) {
    return { ok: false, code: "AI_DISABLED" };
  }

  const result = await deps.run(
    { ticketId: ticketId.data, trigger: "admin_retry", requestedBy: actor.id },
    deps.logger,
  );
  return result.ok
    ? {
        ok: true,
        value: {
          outcome: result.outcome,
          status: result.status,
          failureCode: result.failureCode ?? null,
        },
      }
    : { ok: false, code: STORE_FAILURES[result.code] };
}
