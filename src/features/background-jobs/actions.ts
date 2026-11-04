"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS, type ApiErrorCode } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const jobIdSchema = z.uuid();

function codeFor(sqlState: string | undefined): ApiErrorCode {
  switch (sqlState) {
    case "MR403":
      return "FORBIDDEN";
    case "MR404":
      return "NOT_FOUND";
    case "MR422":
      return "INVALID_TRANSITION";
    case "MR429":
      return "RATE_LIMITED";
    case undefined:
    default:
      return "SERVICE_UNAVAILABLE";
  }
}

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  INVALID_TRANSITION: "This job is no longer waiting for review. Refresh to see where it is.",
  RATE_LIMITED: "This job has already been retried three times.",
};

/** The admin "Retry" button on a job waiting for review (A1.04). Limits are enforced in SQL. */
export async function retryJobAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user?.role !== "admin") {
    return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  }
  const jobId = jobIdSchema.safeParse(formData.get("jobId"));
  if (!jobId.success) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("admin_retry_ai_job", { p_job_id: jobId.data });
  const logger = getLogger().child({ requestId: createRequestId(), route: "action retryJob" });
  if (error !== null) {
    const code = codeFor(error.code);
    logger.warn("ai_job.retry_refused", { jobId: jobId.data, code });
    return { status: "error", message: MESSAGES[code] ?? API_ERRORS[code].message };
  }
  logger.info("ai_job.retry_queued", { jobId: jobId.data });
  // The job leaves the "needs review" list, so the confirmation belongs to the page.
  redirect("/admin/jobs?notice=retried");
}
