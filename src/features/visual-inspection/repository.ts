import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import type { ImageQuality, ReviewDecision, TextConsistency } from "./labels";

export type AnalysisState = "analysing" | "done" | "with_staff";

/** The ticket does not exist or the caller cannot see it (the two are indistinguishable). */
export class ComplaintNotVisibleError extends Error {
  override readonly name = "ComplaintNotVisibleError";
}

export interface VisualAnalysis {
  readonly id: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly visibleObservations: readonly string[];
  readonly possibleIssue: string;
  readonly suggestedCategory: string | null;
  readonly severityHint: string;
  readonly notVisibleOrUncertain: readonly string[];
  readonly imageQuality: ImageQuality;
  readonly textConsistency: TextConsistency;
  readonly needsHumanReview: boolean;
  readonly uncertaintyFlags: readonly string[];
  readonly explanation: string;
  readonly createdAt: string;
}

export interface AnalysisReview {
  readonly decision: ReviewDecision;
  readonly reviewerRole: string;
  readonly correctedCategory: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface PhotoAnalysis {
  readonly attachmentId: string;
  readonly state: AnalysisState;
  readonly analysis: VisualAnalysis | null;
  /** The newest response from a person, if any. */
  readonly latestReview: AnalysisReview | null;
}

/**
 * The analysis state of each finalised photo on a ticket the caller can see. A photo whose job
 * failed every attempt is "with staff": an administrator looks at it instead (plan §05).
 */
export async function loadPhotoAnalyses(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<readonly PhotoAnalysis[]> {
  const [states, analyses] = await Promise.all([
    client.rpc("photo_analysis_states", { p_complaint_id: complaintId }),
    client
      .from("visual_analyses")
      .select(
        "id, attachment_id, prompt_version, model, visible_observations, possible_issue, suggested_category, severity_hint, not_visible_or_uncertain, image_quality, text_consistency, needs_human_review, uncertainty_flags, explanation, created_at",
      )
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false }),
  ]);
  if (states.error?.code === "MR404") {
    throw new ComplaintNotVisibleError();
  }
  if (states.error !== null) {
    throw new Error(`photo_analysis_states failed: ${states.error.code}`);
  }
  if (analyses.error !== null) {
    throw new Error(`visual_analyses query failed: ${analyses.error.code}`);
  }

  // Newest analysis per photo (a later prompt version may analyse the same photo again).
  const byAttachment = new Map<string, (typeof analyses.data)[number]>();
  for (const row of analyses.data) {
    if (!byAttachment.has(row.attachment_id)) {
      byAttachment.set(row.attachment_id, row);
    }
  }

  const analysisIds = [...byAttachment.values()].map((row) => row.id);
  const reviews =
    analysisIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("visual_analysis_reviews")
          .select("analysis_id, decision, reviewer_role, corrected_category, note, created_at")
          .in("analysis_id", analysisIds)
          .order("id", { ascending: false });
  if (reviews.error !== null) {
    throw new Error(`visual_analysis_reviews query failed: ${reviews.error.code}`);
  }
  const latestReview = new Map<string, AnalysisReview>();
  for (const review of reviews.data) {
    if (!latestReview.has(review.analysis_id)) {
      latestReview.set(review.analysis_id, {
        decision: review.decision,
        reviewerRole: review.reviewer_role,
        correctedCategory: review.corrected_category,
        note: review.note,
        createdAt: review.created_at,
      });
    }
  }

  return states.data.map(({ attachment_id, job_status }) => {
    const row = byAttachment.get(attachment_id);
    const analysis: VisualAnalysis | null =
      row === undefined
        ? null
        : {
            id: row.id,
            promptVersion: row.prompt_version,
            model: row.model,
            visibleObservations: row.visible_observations,
            possibleIssue: row.possible_issue,
            suggestedCategory: row.suggested_category,
            severityHint: row.severity_hint,
            notVisibleOrUncertain: row.not_visible_or_uncertain,
            imageQuality: row.image_quality,
            textConsistency: row.text_consistency,
            needsHumanReview: row.needs_human_review,
            uncertaintyFlags: row.uncertainty_flags,
            explanation: row.explanation,
            createdAt: row.created_at,
          };
    const state: AnalysisState =
      analysis !== null ? "done" : job_status === "needs_review" ? "with_staff" : "analysing";
    return {
      attachmentId: attachment_id,
      state,
      analysis,
      latestReview: analysis === null ? null : (latestReview.get(analysis.id) ?? null),
    };
  });
}
