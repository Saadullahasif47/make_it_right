import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export type ImageQuality = Enums["image_quality"];
export type TextConsistency = Enums["text_image_consistency"];
export type ReviewDecision = Enums["visual_review_decision"];

export function categoryLabel(category: string | null): string {
  if (category === null) return "Not clear from the photo";
  return isComplaintCategory(category) ? CATEGORY_LABELS[category] : category;
}

export const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** What each uncertainty flag means for the person reading the analysis. */
export const FLAG_LABELS: Readonly<Record<string, string>> = {
  IMAGE_BLURRY: "The photo is blurry",
  IMAGE_DARK: "The photo is too dark",
  IMAGE_UNRELATED: "The photo does not seem to show the problem",
  TEXT_IMAGE_MISMATCH: "The photo and the written report do not match",
  CONSISTENCY_UNCLEAR: "Unclear whether the photo matches the report",
  CATEGORY_UNCLEAR: "The type of problem is not clear",
  HIGH_SEVERITY: "Possible danger: a person should check",
  PARTLY_NOT_VISIBLE: "Part of the problem cannot be seen",
  MODEL_REQUESTED_REVIEW: "The AI asked for a person to check",
  CERTAINTY_LANGUAGE: "The AI sounded more certain than a photo allows",
};

export const RETAKE_FLAGS = new Set(["IMAGE_BLURRY", "IMAGE_DARK", "IMAGE_UNRELATED"]);

export const DECISION_LABELS: Readonly<Record<ReviewDecision, string>> = {
  confirmed: "Confirmed",
  disputed: "Disputed",
  corrected: "Corrected",
};
