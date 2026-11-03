"use server";

import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/session";
import { ticketPathFor } from "@/features/complaints/paths";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";

import { getTriageRunner } from "./instance";
import { retryTriage } from "./retry";

/** The admin "Retry AI routing" button: same use case as POST /api/complaints/[id]/retry-ai. */
export async function retryAiAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: API_ERRORS.UNAUTHENTICATED.message };
  }
  const rawTicketId = formData.get("ticketId");
  const ticketId = typeof rawTicketId === "string" ? rawTicketId : "";
  const result = await retryTriage(
    {
      run: getTriageRunner(),
      logger: getLogger().child({ requestId: createRequestId(), route: "action retryAi" }),
    },
    user,
    ticketId,
  );
  if (!result.ok) {
    return { status: "error", message: API_ERRORS[result.code].message };
  }
  const notice = result.value.outcome === "routed" ? "ai-routed" : "ai-review";
  redirect(`${ticketPathFor(user.role, ticketId)}?notice=${notice}`);
}
