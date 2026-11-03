"use server";

import { redirect } from "next/navigation";

import { submissionTriage } from "@/features/agent/instance";
import { getSessionUser } from "@/features/auth/session";
import { readFields, type FormState } from "@/lib/forms/form-state";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import type { FieldErrors } from "@/lib/http/api-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { FAILURE_MESSAGES } from "./messages";
import { submitComplaint } from "./service";

const COMPLAINT_FIELDS = ["title", "description", "building", "room"] as const;
export type ComplaintField = (typeof COMPLAINT_FIELDS)[number];

/** Keeps only errors for fields the form shows; anything else is covered by the message. */
function formFieldErrors(fields: FieldErrors | undefined): Partial<Record<ComplaintField, string>> {
  const result: Partial<Record<ComplaintField, string>> = {};
  for (const field of COMPLAINT_FIELDS) {
    const message = fields?.[field];
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

/**
 * Web-form entry point to the same use case as POST /api/complaints. The idempotency key is
 * rendered into the form once, so a double click or a retry after a network error re-sends the
 * same key and the database returns the ticket it already created.
 */
export async function submitComplaintAction(
  _previous: FormState<ComplaintField>,
  formData: FormData,
): Promise<FormState<ComplaintField>> {
  const values = readFields(formData, COMPLAINT_FIELDS);
  const idempotencyKey = formData.get("idempotencyKey");

  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: FAILURE_MESSAGES.UNAUTHENTICATED, values };
  }
  if (user.role !== "student") {
    return { status: "error", message: "Only student accounts can submit reports here.", values };
  }

  const logger = getLogger().child({
    requestId: createRequestId(),
    route: "action submitComplaint",
  });
  const result = await submitComplaint(
    {
      client: await createSupabaseServerClient(),
      logger,
      triage: submissionTriage(user.id, logger),
    },
    {
      title: values.title ?? "",
      description: values.description ?? "",
      building: values.building ?? "",
      room: values.room ?? "",
    },
    idempotencyKey,
  );

  if (!result.ok) {
    return {
      status: "error",
      message: FAILURE_MESSAGES[result.code],
      fieldErrors: formFieldErrors(result.fields),
      values,
    };
  }

  const notice = !result.ticket.created
    ? "already-submitted"
    : result.ticket.status === "assigned"
      ? "created-routed"
      : "created";
  redirect(`/student/complaints/${result.ticket.id}?notice=${notice}`);
}
