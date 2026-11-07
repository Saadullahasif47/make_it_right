"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import { isFeatureEnabled } from "@/lib/config";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function guard(): Promise<FormState<never> | null> {
  const user = await getSessionUser();
  if (user?.role !== "admin") return { status: "error", message: API_ERRORS.FORBIDDEN.message };
  if (!isFeatureEnabled("maintenanceInsights")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  return null;
}

const log = (route: string) => getLogger().child({ requestId: createRequestId(), route });

const acknowledgeSchema = z.strictObject({
  alertId: z.uuid(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((note) => (note === "" ? undefined : note)),
});

/** An administrator has seen an alert; it stays listed until its rule stops holding (F6.04). */
export async function acknowledgeAlertAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const refused = await guard();
  if (refused !== null) return refused;
  const input = acknowledgeSchema.safeParse({
    alertId: formData.get("alertId"),
    note: formData.get("note") ?? "",
  });
  if (!input.success) return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message };

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("admin_acknowledge_alert", {
    p_alert_id: input.data.alertId,
    ...(input.data.note === undefined ? {} : { p_note: input.data.note }),
  });
  if (error !== null) {
    log("action acknowledgeAlert").warn("insights.acknowledge_refused", { code: error.code });
    return {
      status: "error",
      message:
        error.code === "MR422"
          ? "This alert was already acknowledged or has cleared. Refresh the page."
          : API_ERRORS.SERVICE_UNAVAILABLE.message,
    };
  }
  redirect("/admin/insights?notice=alert-acknowledged");
}

/** Runs the daily rule refresh now (the same function the scheduled job runs). */
export async function refreshAlertsAction(
  _previous: FormState<never>,
  _formData: FormData,
): Promise<FormState<never>> {
  const refused = await guard();
  if (refused !== null) return refused;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("admin_refresh_alerts");
  if (error !== null) {
    log("action refreshAlerts").warn("insights.refresh_failed", { code: error.code });
    return { status: "error", message: API_ERRORS.SERVICE_UNAVAILABLE.message };
  }
  log("action refreshAlerts").info("insights.refreshed", { result: data });
  redirect("/admin/insights?notice=alerts-refreshed");
}

const slaSchema = z.strictObject({
  category: z.enum(COMPLAINT_CATEGORIES),
  targetDays: z.coerce.number().int().min(1).max(90),
});

/** Changes a category's response-time target used by LONG_UNRESOLVED. */
export async function setSlaAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const refused = await guard();
  if (refused !== null) return refused;
  const input = slaSchema.safeParse({
    category: formData.get("category"),
    targetDays: formData.get("targetDays"),
  });
  if (!input.success)
    return { status: "error", message: "Enter a whole number of days from 1 to 90." };
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("admin_set_category_sla", {
    p_category: input.data.category,
    p_target_days: input.data.targetDays,
  });
  if (error !== null) return { status: "error", message: API_ERRORS.SERVICE_UNAVAILABLE.message };
  redirect("/admin/insights?notice=target-saved");
}
