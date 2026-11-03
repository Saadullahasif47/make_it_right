"use server";

import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/session";
import { ComplaintError } from "@/features/complaints/errors";
import { FAILURE_MESSAGES } from "@/features/complaints/messages";
import type { FormState } from "@/lib/forms/form-state";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  departmentToggleSchema,
  routingRuleSchema,
  setDepartmentActive,
  setRoutingRule,
} from "./config";

function fields(formData: FormData, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, formData.get(name) ?? undefined]));
}

/**
 * Runs one audited configuration change for an administrator and redirects back with a notice.
 * The database re-checks the role, so a forged form from another role is refused there too.
 */
async function perform(
  action: string,
  change: () => Promise<string>,
  invalidMessage: string,
): Promise<FormState<never>> {
  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: FAILURE_MESSAGES.UNAUTHENTICATED };
  }
  if (user.role !== "admin") {
    return { status: "error", message: FAILURE_MESSAGES.FORBIDDEN };
  }
  const logger = getLogger().child({ requestId: createRequestId(), route: `action ${action}` });
  let notice: string;
  try {
    notice = await change();
    logger.info(`admin.${action}`);
  } catch (error) {
    if (error instanceof ComplaintError) {
      logger.warn(`admin.${action}_rejected`, { code: error.code });
      return {
        status: "error",
        message: error.code === "VALIDATION_FAILED" ? invalidMessage : FAILURE_MESSAGES[error.code],
      };
    }
    logger.error(`admin.${action}_failed`, { error });
    return { status: "error", message: FAILURE_MESSAGES.SERVICE_UNAVAILABLE };
  }
  redirect(`/admin/departments?notice=${notice}`);
}

export async function toggleDepartmentAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const parsed = departmentToggleSchema.safeParse(fields(formData, ["departmentId", "active"]));
  if (!parsed.success) {
    return { status: "error", message: FAILURE_MESSAGES.VALIDATION_FAILED };
  }
  return perform(
    "department_availability",
    async () => {
      const result = await setDepartmentActive(
        await createSupabaseServerClient(),
        parsed.data.departmentId,
        parsed.data.active,
      );
      if (!result.changed) {
        return "no-change";
      }
      if (result.value.isActive) {
        return "department-activated";
      }
      return result.value.routesAffected > 0
        ? "department-deactivated-routes"
        : "department-deactivated";
    },
    FAILURE_MESSAGES.VALIDATION_FAILED,
  );
}

export async function saveRoutingRuleAction(
  _previous: FormState<never>,
  formData: FormData,
): Promise<FormState<never>> {
  const parsed = routingRuleSchema.safeParse(
    fields(formData, ["category", "departmentId", "enabled"]),
  );
  if (!parsed.success) {
    return { status: "error", message: FAILURE_MESSAGES.VALIDATION_FAILED };
  }
  return perform(
    "routing_rule",
    async () => {
      const result = await setRoutingRule(
        await createSupabaseServerClient(),
        parsed.data.category,
        parsed.data.departmentId,
        parsed.data.enabled,
      );
      return result.changed ? "routing-saved" : "no-change";
    },
    "An enabled rule needs an active department. Choose another department or disable the rule.",
  );
}
