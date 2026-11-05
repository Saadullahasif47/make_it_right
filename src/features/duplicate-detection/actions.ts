"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { isFeatureEnabled } from "@/lib/config";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reviewSchema = z.strictObject({
  complaintId: complaintIdSchema,
  candidateId: z.uuid(),
  decision: z.enum(["accepted", "rejected"]),
  expectedVersion: z.coerce.number().int().positive(),
});

/** Plain messages for the codes review_match_candidate raises. */
function messageFor(code: string | undefined): string {
  switch (code) {
    case "MR412":
      return "That case changed since you opened this page. Refresh and check the candidate again.";
    case "MR422":
      return "This candidate can no longer be linked (already decided, the case closed, or the report already shares a case). Refresh to see where it stands.";
    case "MR403":
    case "MR404":
      return API_ERRORS.FORBIDDEN.message;
    case undefined:
    default:
      return API_ERRORS.SERVICE_UNAVAILABLE.message;
  }
}

async function adminGuard(): Promise<FormState<never> | null> {
  const user = await getSessionUser();
  if (user?.role !== "admin") {
    return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  }
  if (!isFeatureEnabled("duplicateDetection")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  return null;
}

/**
 * An administrator's decision on one duplicate candidate (plan v2 F2.04-F2.05). Accepting links
 * the report into the case in one database transaction; rejecting changes nothing else.
 */
export async function reviewCandidateAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const refused = await adminGuard();
  if (refused !== null) return refused;

  const input = reviewSchema.safeParse({
    complaintId: formData.get("complaintId"),
    candidateId: formData.get("candidateId"),
    decision: formData.get("decision"),
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!input.success) {
    return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("review_match_candidate", {
    p_candidate_id: input.data.candidateId,
    p_decision: input.data.decision,
    p_expected_case_version: input.data.expectedVersion,
  });
  const logger = getLogger().child({
    requestId: createRequestId(),
    route: "action reviewCandidate",
  });
  if (error !== null) {
    logger.warn("duplicates.review_refused", {
      candidateId: input.data.candidateId,
      code: error.code,
    });
    return { status: "error", message: messageFor(error.code) };
  }
  logger.info("duplicates.reviewed", {
    candidateId: input.data.candidateId,
    decision: input.data.decision,
  });
  // The page changes shape after a decision (a shared case, or a decided candidate), so the
  // confirmation belongs to the page, not to this form.
  redirect(
    `/admin/complaints/${input.data.complaintId}?notice=${
      input.data.decision === "accepted" ? "duplicate-linked" : "duplicate-rejected"
    }`,
  );
}

/** "Keep as a separate case": rejects every pending candidate of the report. */
export async function keepSeparateAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const refused = await adminGuard();
  if (refused !== null) return refused;
  const complaintId = complaintIdSchema.safeParse(formData.get("complaintId"));
  if (!complaintId.success) {
    return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };
  }
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("dismiss_match_candidates", {
    p_complaint_id: complaintId.data,
  });
  if (error !== null) {
    return { status: "error", message: messageFor(error.code) };
  }
  redirect(`/admin/complaints/${complaintId.data}?notice=duplicate-separate`);
}
