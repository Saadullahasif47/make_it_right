"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionUser } from "@/features/auth/session";
import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import { ticketPathFor } from "@/features/complaints/paths";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { isFeatureEnabled } from "@/lib/config";
import type { FormState } from "@/lib/forms/form-state";
import { API_ERRORS } from "@/lib/http/api-error";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ReviewField = "note" | "correctedCategory";

const reviewSchema = z
  .strictObject({
    complaintId: complaintIdSchema,
    analysisId: z.uuid(),
    decision: z.enum(["confirmed", "disputed", "corrected"]),
    correctedCategory: z.enum(COMPLAINT_CATEGORIES).optional(),
    note: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters.")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
  })
  .refine((input) => input.decision !== "disputed" || input.note !== undefined, {
    path: ["note"],
    message: "Say what the AI got wrong.",
  })
  .refine((input) => input.decision !== "corrected" || input.correctedCategory !== undefined, {
    path: ["correctedCategory"],
    message: "Choose the correct category.",
  });

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A person's response to an AI photo analysis (plan v2 F1, A2.02): the reporter confirms or
 * disputes, an admin may also correct the category. It is recorded beside the analysis and never
 * changes it; the database enforces who may respond.
 */
export async function reviewAnalysisAction(
  _previous: FormState<ReviewField>,
  formData: FormData,
): Promise<FormState<ReviewField>> {
  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: API_ERRORS.UNAUTHENTICATED.message };
  }
  if (!isFeatureEnabled("visualInspection")) {
    return { status: "error", message: API_ERRORS.NOT_FOUND.message };
  }
  const input = reviewSchema.safeParse({
    complaintId: field(formData, "complaintId"),
    analysisId: field(formData, "analysisId"),
    decision: field(formData, "decision"),
    correctedCategory: field(formData, "correctedCategory"),
    note: field(formData, "note"),
  });
  if (!input.success) {
    const fieldErrors: Partial<Record<ReviewField, string>> = {};
    for (const issue of input.error.issues) {
      const name = issue.path[0];
      if ((name === "note" || name === "correctedCategory") && fieldErrors[name] === undefined) {
        fieldErrors[name] = issue.message;
      }
    }
    return { status: "error", message: API_ERRORS.VALIDATION_FAILED.message, fieldErrors };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("review_visual_analysis", {
    p_analysis_id: input.data.analysisId,
    p_decision: input.data.decision,
    ...(input.data.correctedCategory === undefined
      ? {}
      : { p_corrected_category: input.data.correctedCategory }),
    ...(input.data.note === undefined ? {} : { p_note: input.data.note }),
  });
  const logger = getLogger().child({
    requestId: createRequestId(),
    route: "action reviewAnalysis",
  });
  if (error !== null) {
    logger.warn("visual_analysis.review_refused", { code: error.code });
    const message =
      error.code === "MR429"
        ? "You have already responded to this analysis several times."
        : error.code === "MR404" || error.code === "MR403"
          ? API_ERRORS.FORBIDDEN.message
          : API_ERRORS.SERVICE_UNAVAILABLE.message;
    return { status: "error", message };
  }
  logger.info("visual_analysis.reviewed", {
    analysisId: input.data.analysisId,
    decision: input.data.decision,
  });
  revalidatePath(ticketPathFor(user.role, input.data.complaintId));
  return { status: "success", message: "Thanks, your response is recorded." };
}
