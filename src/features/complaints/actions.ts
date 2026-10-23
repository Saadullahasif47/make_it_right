"use server";

import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/session";
import { readFields, type FormState } from "@/lib/forms/form-state";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import type { FieldErrors } from "@/lib/http/api-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { ComplaintFailureCode } from "./errors";
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

const FAILURE_MESSAGES: Readonly<Record<ComplaintFailureCode, string>> = {
  VALIDATION_FAILED: "Some details need fixing before we can save your report.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to submit your report.",
  RATE_LIMITED:
    "You have submitted several reports in a short time. Please wait a few minutes and try again.",
  IDEMPOTENCY_CONFLICT:
    "This form was already used for a different report. Reload the page to start a new one.",
  SERVICE_UNAVAILABLE:
    "We could not save your report right now. Nothing was lost: please try again in a moment.",
};

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

  const result = await submitComplaint(
    {
      client: await createSupabaseServerClient(),
      logger: getLogger().child({ requestId: createRequestId(), route: "action submitComplaint" }),
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

  const notice = result.ticket.created ? "created" : "already-submitted";
  redirect(`/student/complaints/${result.ticket.id}?notice=${notice}`);
}
