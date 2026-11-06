"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import { ticketPathFor } from "@/features/complaints/paths";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { isFeatureEnabled } from "@/lib/config";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const requestSchema = z.strictObject({
  complaintId: complaintIdSchema,
  caseId: z.uuid(),
});

const decisionSchema = z.strictObject({
  complaintId: complaintIdSchema,
  proposalId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  expectedVersion: z.coerce.number().int().positive(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((note) => (note === "" ? undefined : note)),
});

/** Plain messages for the codes the coordination functions raise. */
function messageFor(code: string | undefined): string {
  switch (code) {
    case "MR412":
      return "This case changed since you opened the page. Refresh and check the proposal again.";
    case "MR422":
      return "This can no longer be done (already decided, or the case is closed). Refresh to see where it stands.";
    case "MR403":
    case "MR404":
      return API_ERRORS.FORBIDDEN.message;
    case undefined:
    default:
      return API_ERRORS.SERVICE_UNAVAILABLE.message;
  }
}

function logger(route: string) {
  return getLogger().child({ requestId: createRequestId(), route });
}

/**
 * Asks the coordinator to look at a case (plan v2 F3, A4.01). It only queues a bounded job: the
 * page shows the result once the worker has finished.
 */
export async function requestCoordinationAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user === null || user.role === "student") {
    return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  }
  if (!isFeatureEnabled("maintenanceCoordinator")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  const input = requestSchema.safeParse({
    complaintId: formData.get("complaintId"),
    caseId: formData.get("caseId"),
  });
  if (!input.success) {
    return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };
  }

  const client = await createSupabaseServerClient();
  const { data: jobId, error } = await client.rpc("request_case_coordination", {
    p_case_id: input.data.caseId,
  });
  const log = logger("action requestCoordination");
  if (error !== null) {
    log.warn("coordination.request_refused", { caseId: input.data.caseId, code: error.code });
    return { status: "error", message: messageFor(error.code) };
  }
  log.info("coordination.requested", { caseId: input.data.caseId, jobId });
  redirect(`${ticketPathFor(user.role, input.data.complaintId)}?notice=coordination-queued`);
}

const DECISION_NOTICES: Readonly<Record<string, string>> = {
  committed: "coordination-approved",
  rejected: "coordination-rejected",
  stale: "coordination-stale",
};

/**
 * An administrator's decision on a pending proposal (F3.04). Approving commits one work order
 * against the case version the admin saw; rejecting leaves the case for manual routing.
 */
export async function decideProposalAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user?.role !== "admin") {
    return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  }
  if (!isFeatureEnabled("maintenanceCoordinator")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  const input = decisionSchema.safeParse({
    complaintId: formData.get("complaintId"),
    proposalId: formData.get("proposalId"),
    decision: formData.get("decision"),
    expectedVersion: formData.get("expectedVersion"),
    note: formData.get("note") ?? "",
  });
  if (!input.success) {
    return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };
  }

  const client = await createSupabaseServerClient();
  const { data: result, error } = await client.rpc("admin_decide_proposal", {
    p_proposal_id: input.data.proposalId,
    p_approve: input.data.decision === "approve",
    p_expected_case_version: input.data.expectedVersion,
    ...(input.data.note === undefined ? {} : { p_note: input.data.note }),
  });
  const log = logger("action decideProposal");
  if (error !== null) {
    log.warn("coordination.decision_refused", {
      proposalId: input.data.proposalId,
      code: error.code,
    });
    return { status: "error", message: messageFor(error.code) };
  }
  log.info("coordination.decided", { proposalId: input.data.proposalId, result });
  redirect(
    `/admin/complaints/${input.data.complaintId}?notice=${DECISION_NOTICES[result] ?? "coordination-stale"}`,
  );
}
