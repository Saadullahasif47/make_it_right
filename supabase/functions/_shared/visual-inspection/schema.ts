import { z } from "zod";

import { sanitizeForModel } from "../text/sanitize.ts";

/**
 * The structured answer the vision model must give (plan v2 §06), and the deterministic policy
 * that turns it into the stored analysis. Every field is a suggestion; the policy, not the
 * model, decides when a person must look.
 */
export const VISUAL_PROMPT_VERSION = "visual-v1";

export const VISUAL_CATEGORIES = [
  "electrical",
  "it_equipment",
  "plumbing",
  "furniture",
  "sanitation",
  "other",
  "unclear",
] as const;

export const SEVERITY_HINTS = ["low", "medium", "high"] as const;
export const IMAGE_QUALITIES = ["usable", "blurry", "dark", "unrelated"] as const;
export const TEXT_CONSISTENCIES = ["consistent", "inconsistent", "unclear"] as const;

/** Generous on input; long strings are cut to the stored limits after validation. */
const text = z.string().trim().min(1).max(1000);

export const modelOutputSchema = z.strictObject({
  visible_observations: z.array(text).min(1).max(6),
  possible_issue: text,
  suggested_category: z.enum(VISUAL_CATEGORIES),
  severity_hint: z.enum(SEVERITY_HINTS),
  not_visible_or_uncertain: z.array(text).max(6),
  image_quality: z.enum(IMAGE_QUALITIES),
  text_consistency: z.enum(TEXT_CONSISTENCIES),
  needs_human_review: z.boolean(),
  explanation: text,
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** The same contract as a JSON Schema, for Gemini's structured output (responseJsonSchema). */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    visible_observations: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 6,
      description: "Only what can actually be seen in the photo, one short phrase each.",
    },
    possible_issue: {
      type: "string",
      description:
        "The most likely problem, phrased as a possibility, e.g. 'possible plumbing leak'.",
    },
    suggested_category: { type: "string", enum: [...VISUAL_CATEGORIES] },
    severity_hint: { type: "string", enum: [...SEVERITY_HINTS] },
    not_visible_or_uncertain: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
      description:
        "What the photo cannot show or leaves uncertain, e.g. 'pipe behind the cabinet'.",
    },
    image_quality: { type: "string", enum: [...IMAGE_QUALITIES] },
    text_consistency: {
      type: "string",
      enum: [...TEXT_CONSISTENCIES],
      description: "Whether the photo matches the written report.",
    },
    needs_human_review: { type: "boolean" },
    explanation: {
      type: "string",
      description: "One or two cautious sentences linking what is visible to the possible issue.",
    },
  },
  required: [
    "visible_observations",
    "possible_issue",
    "suggested_category",
    "severity_hint",
    "not_visible_or_uncertain",
    "image_quality",
    "text_consistency",
    "needs_human_review",
    "explanation",
  ],
} as const;

/** Words that claim more than a photo can show; their presence sends the analysis to a person. */
const CERTAINTY =
  /\b(definitely|certainly|guaranteed|undoubtedly|confirmed|100 ?%|proves?|is safe)\b/i;

export interface StoredAnalysis {
  readonly visible_observations: readonly string[];
  readonly possible_issue: string;
  readonly suggested_category: (typeof VISUAL_CATEGORIES)[number];
  readonly severity_hint: (typeof SEVERITY_HINTS)[number];
  readonly not_visible_or_uncertain: readonly string[];
  readonly image_quality: (typeof IMAGE_QUALITIES)[number];
  readonly text_consistency: (typeof TEXT_CONSISTENCIES)[number];
  readonly needs_human_review: boolean;
  readonly uncertainty_flags: readonly string[];
  readonly explanation: string;
}

/**
 * Cleans the model's text for storage (no control characters or markup, bounded lengths) and
 * decides review deterministically: a poor photo, a mismatch with the report, an unclear
 * category, a high severity or overconfident wording always go to a person, whatever the model
 * said about itself.
 */
export function toStoredAnalysis(output: ModelOutput): StoredAnalysis {
  const flags: string[] = [];
  const add = (condition: boolean, flag: string): void => {
    if (condition) flags.push(flag);
  };
  const observations = output.visible_observations.map((item) => sanitizeForModel(item, 160));
  const uncertain = output.not_visible_or_uncertain.map((item) => sanitizeForModel(item, 160));
  const explanation = sanitizeForModel(output.explanation, 400);
  const possibleIssue = sanitizeForModel(output.possible_issue, 120);
  const overconfident = CERTAINTY.test([explanation, possibleIssue, ...observations].join(" "));

  add(output.image_quality === "blurry", "IMAGE_BLURRY");
  add(output.image_quality === "dark", "IMAGE_DARK");
  add(output.image_quality === "unrelated", "IMAGE_UNRELATED");
  add(output.text_consistency === "inconsistent", "TEXT_IMAGE_MISMATCH");
  add(output.text_consistency === "unclear", "CONSISTENCY_UNCLEAR");
  add(output.suggested_category === "unclear", "CATEGORY_UNCLEAR");
  add(output.severity_hint === "high", "HIGH_SEVERITY");
  add(uncertain.length > 0, "PARTLY_NOT_VISIBLE");
  add(output.needs_human_review, "MODEL_REQUESTED_REVIEW");
  add(overconfident, "CERTAINTY_LANGUAGE");

  const needsReview =
    output.needs_human_review ||
    output.image_quality !== "usable" ||
    output.text_consistency === "inconsistent" ||
    output.suggested_category === "unclear" ||
    output.severity_hint === "high" ||
    overconfident;

  return {
    visible_observations: observations,
    possible_issue: possibleIssue,
    suggested_category: output.suggested_category,
    severity_hint: output.severity_hint,
    not_visible_or_uncertain: uncertain,
    image_quality: output.image_quality,
    text_consistency: output.text_consistency,
    needs_human_review: needsReview,
    uncertainty_flags: flags,
    explanation,
  };
}
