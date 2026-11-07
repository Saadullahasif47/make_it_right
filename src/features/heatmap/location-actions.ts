"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import { ticketPathFor } from "@/features/complaints/paths";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { isFeatureEnabled } from "@/lib/config";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const optionalId = z
  .string()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(z.uuid().optional());

const locationSchema = z.strictObject({
  complaintId: complaintIdSchema,
  caseId: z.uuid(),
  locationId: optionalId,
  assetId: optionalId,
  expectedVersion: z.coerce.number().int().positive(),
});

function messageFor(code: string | undefined): string {
  switch (code) {
    case "MR412":
      return "This case changed since you opened the page. Refresh and choose again.";
    case "22023":
      return "That equipment is in another room. Choose its room, or leave the room empty.";
    case "MR422":
      return "A closed case keeps its location.";
    case "MR403":
    case "MR404":
      return API_ERRORS.FORBIDDEN.message;
    case undefined:
    default:
      return API_ERRORS.SERVICE_UNAVAILABLE.message;
  }
}

/**
 * Staff set a case's room and equipment (plan v2 F5.01, F6.01), so the heatmap and the insight
 * rules count it in the right place. Choosing equipment sets its room.
 */
export async function setCaseLocationAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user === null || user.role === "student") {
    return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  }
  if (!isFeatureEnabled("campusHeatmap") && !isFeatureEnabled("maintenanceInsights")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  const input = locationSchema.safeParse({
    complaintId: formData.get("complaintId"),
    caseId: formData.get("caseId"),
    locationId: formData.get("locationId") ?? "",
    assetId: formData.get("assetId") ?? "",
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!input.success) return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("set_case_location", {
    p_case_id: input.data.caseId,
    p_expected_version: input.data.expectedVersion,
    ...(input.data.locationId === undefined ? {} : { p_location_id: input.data.locationId }),
    ...(input.data.assetId === undefined ? {} : { p_asset_id: input.data.assetId }),
  });
  if (error !== null) return { status: "error", message: messageFor(error.code) };
  redirect(`${ticketPathFor(user.role, input.data.complaintId)}?notice=location-set`);
}
