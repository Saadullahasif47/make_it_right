"use server";

import { redirect } from "next/navigation";

import { getSessionUser, type SessionUser } from "@/features/auth/session";
import type { FormState } from "@/lib/forms/form-state";
import type { FieldErrors } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { FAILURE_MESSAGES } from "./messages";
import { ticketPathFor } from "./paths";
import {
  acknowledge,
  addNote,
  assign,
  changeStatus,
  type WorkflowDependencies,
  type WorkflowResult,
} from "./workflow-service";

export type WorkflowField = "note" | "departmentId" | "category" | "priority";

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function pickFields(fields: FieldErrors | undefined): Partial<Record<WorkflowField, string>> {
  const result: Partial<Record<WorkflowField, string>> = {};
  for (const field of ["note", "departmentId", "category", "priority"] as const) {
    const message = fields?.[field];
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

async function dependencies(action: string): Promise<WorkflowDependencies> {
  return {
    client: await createSupabaseServerClient(),
    logger: getLogger().child({ requestId: createRequestId(), route: `action ${action}` }),
  };
}

/**
 * Runs a workflow use case for the signed-in user and either redirects back to the ticket with
 * a confirmation, or returns the failure for the form to show. The database authorises; this
 * layer only translates.
 */
async function perform<T>(
  formData: FormData,
  action: string,
  run: (
    deps: WorkflowDependencies,
    user: SessionUser,
    ticketId: string,
  ) => Promise<WorkflowResult<T>>,
  notice: (value: T) => string,
): Promise<FormState<WorkflowField>> {
  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: FAILURE_MESSAGES.UNAUTHENTICATED };
  }
  const ticketId = text(formData, "ticketId") ?? "";

  const result = await run(await dependencies(action), user, ticketId);
  if (!result.ok) {
    return {
      status: "error",
      message: FAILURE_MESSAGES[result.code],
      fieldErrors: pickFields(result.fields),
      values: { note: text(formData, "note") ?? "" },
    };
  }
  redirect(`${ticketPathFor(user.role, ticketId)}?notice=${notice(result.value)}`);
}

export async function changeStatusAction(
  _previous: FormState<WorkflowField>,
  formData: FormData,
): Promise<FormState<WorkflowField>> {
  return perform(
    formData,
    "changeStatus",
    (deps, _user, ticketId) =>
      changeStatus(deps, ticketId, {
        target: text(formData, "target"),
        expectedVersion: text(formData, "expectedVersion"),
        note: text(formData, "note"),
      }),
    (ticket) => ticket.status,
  );
}

export async function acknowledgeAction(
  _previous: FormState<WorkflowField>,
  formData: FormData,
): Promise<FormState<WorkflowField>> {
  return perform(
    formData,
    "acknowledge",
    (deps, _user, ticketId) =>
      acknowledge(deps, ticketId, { expectedVersion: text(formData, "expectedVersion") }),
    () => "acknowledged",
  );
}

export async function addNoteAction(
  _previous: FormState<WorkflowField>,
  formData: FormData,
): Promise<FormState<WorkflowField>> {
  return perform(
    formData,
    "addNote",
    (deps, _user, ticketId) => addNote(deps, ticketId, { note: text(formData, "note") ?? "" }),
    () => "note",
  );
}

export async function assignAction(
  _previous: FormState<WorkflowField>,
  formData: FormData,
): Promise<FormState<WorkflowField>> {
  return perform(
    formData,
    "assign",
    (deps, _user, ticketId) =>
      assign(deps, ticketId, {
        departmentId: text(formData, "departmentId"),
        category: text(formData, "category"),
        priority: text(formData, "priority"),
        expectedVersion: text(formData, "expectedVersion"),
        note: text(formData, "note"),
      }),
    () => "assigned",
  );
}
