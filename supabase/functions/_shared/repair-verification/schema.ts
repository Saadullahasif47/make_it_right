import { z } from "zod";

import { sanitizeForModel } from "../text/sanitize.ts";

/**
 * The structured before/after comparison the vision model must give (plan v2 F4.02), and the
 * deterministic policy that turns it into the stored suggestion. The policy can only make an
 * answer more cautious, never more confident: a photo cannot show that a repair works.
 */
export const VERIFY_PROMPT_VERSION = "verify-v1";

export const AI_STATUSES = [
  "visually_improved",
  "possibly_unresolved",
  "inconclusive",
  "not_comparable",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const SAME_SCENE = ["yes", "no", "unclear"] as const;
export const PHOTO_QUALITY = ["usable", "blurry", "dark"] as const;

/** Generous on input; long strings are cut to the stored limits after validation. */
const text = z.string().trim().min(1).max(1000);

export const comparisonSchema = z.strictObject({
  before_observations: z.array(text).min(1).max(5),
  after_observations: z.array(text).min(1).max(5),
  visible_changes: z.array(text).max(5),
  same_scene: z.enum(SAME_SCENE),
  before_quality: z.enum(PHOTO_QUALITY),
  after_quality: z.enum(PHOTO_QUALITY),
  assessment: z.enum(AI_STATUSES),
  not_visible_or_uncertain: z.array(text).max(5),
  explanation: text,
  // F4.02: the answer must say outright that nothing was tested.
  functional_test_not_performed: z.literal(true),
});

export type Comparison = z.infer<typeof comparisonSchema>;

const list = (description: string, minItems = 0) => ({
  type: "array",
  items: { type: "string" },
  minItems,
  maxItems: 5,
  description,
});

/** The same contract as a JSON Schema, for Gemini's structured output (responseJsonSchema). */
export const COMPARISON_JSON_SCHEMA = {
  type: "object",
  properties: {
    before_observations: list("What is visible in the BEFORE photo, one short phrase each.", 1),
    after_observations: list("What is visible in the AFTER photo, one short phrase each.", 1),
    visible_changes: list("Differences you can actually see between the two photos."),
    same_scene: {
      type: "string",
      enum: [...SAME_SCENE],
      description: "Whether both photos show the same place and the same object.",
    },
    before_quality: { type: "string", enum: [...PHOTO_QUALITY] },
    after_quality: { type: "string", enum: [...PHOTO_QUALITY] },
    assessment: {
      type: "string",
      enum: [...AI_STATUSES],
      description:
        "visually_improved: the visible signs of the problem appear reduced. possibly_unresolved: visible signs remain. inconclusive: angle, lighting or framing prevents a comparison. not_comparable: different place or object.",
    },
    not_visible_or_uncertain: list(
      "What the photos cannot show, e.g. whether it works, hidden parts, the cause.",
    ),
    explanation: {
      type: "string",
      description: "One or two cautious sentences. Never say it is fixed or works.",
    },
    functional_test_not_performed: {
      type: "boolean",
      description: "Always true: a photo comparison is not a functional test.",
    },
  },
  required: [
    "before_observations",
    "after_observations",
    "visible_changes",
    "same_scene",
    "before_quality",
    "after_quality",
    "assessment",
    "not_visible_or_uncertain",
    "explanation",
    "functional_test_not_performed",
  ],
} as const;

/** Claims a photo cannot support (F4.02 "never an unqualified 'fully repaired'"). */
const CLAIM =
  /\b(fully|completely|totally|definitely|certainly|properly|100 ?%)\s+(repaired|fixed|resolved|working|functional)\b|\b(is|are|now)\s+(fixed|repaired|working|functional)\b|\bworks?\s+(again|now|fine|perfectly|properly)\b|\bguarantee/i;
/** Words that make a sentence a qualified statement rather than a claim. */
const HEDGE = /\b(whether|if|cannot|can't|not|unknown|unclear|may|might|could)\b/i;

/** True when some sentence asserts a working repair without qualifying it. */
function overclaims(text: string): boolean {
  return text
    .split(/(?<=[.!?;])\s+|\n/)
    .some((sentence) => CLAIM.test(sentence) && !HEDGE.test(sentence));
}

export interface StoredVerification {
  readonly ai_status: AiStatus;
  readonly uncertainty_flags: readonly string[];
  readonly explanation: string;
  readonly before_observations: readonly string[];
  readonly after_observations: readonly string[];
  readonly visible_changes: readonly string[];
  readonly not_visible_or_uncertain: readonly string[];
}

const OVERCLAIM_EXPLANATION =
  "The comparison's wording claimed more than photos can show, so it is treated as inconclusive. A person should check the repair.";

/** Statuses from most to least confident; the policy only ever moves right. */
const CAUTION: readonly AiStatus[] = [
  "visually_improved",
  "possibly_unresolved",
  "inconclusive",
  "not_comparable",
];
const atLeast = (status: AiStatus, floor: AiStatus): AiStatus =>
  CAUTION.indexOf(status) >= CAUTION.indexOf(floor) ? status : floor;

/**
 * Cleans the model's text for storage and applies the caution rules:
 *   different place or object       -> not_comparable
 *   blurry or dark photo            -> at least inconclusive
 *   unclear scene, an improvement   -> inconclusive
 *   overclaiming wording            -> at least inconclusive, explanation replaced
 */
export function toStoredVerification(output: Comparison): StoredVerification {
  const flags: string[] = [];
  const clean = (items: readonly string[]) => items.map((item) => sanitizeForModel(item, 160));
  const before = clean(output.before_observations);
  const after = clean(output.after_observations);
  const changes = clean(output.visible_changes);
  const uncertain = clean(output.not_visible_or_uncertain);
  let explanation = sanitizeForModel(output.explanation, 400);
  let status: AiStatus = output.assessment;

  if (output.same_scene === "no") {
    flags.push("DIFFERENT_SCENE");
    status = "not_comparable";
  } else if (output.same_scene === "unclear") {
    flags.push("SCENE_UNCLEAR");
    if (status === "visually_improved") status = "inconclusive";
  }
  for (const [label, quality] of [
    ["BEFORE", output.before_quality],
    ["AFTER", output.after_quality],
  ] as const) {
    if (quality !== "usable") {
      flags.push(`${label}_${quality.toUpperCase()}`);
      status = atLeast(status, "inconclusive");
    }
  }
  if ([explanation, ...after, ...changes].some(overclaims)) {
    flags.push("OVERCLAIM");
    status = atLeast(status, "inconclusive");
    explanation = OVERCLAIM_EXPLANATION;
  }
  if (uncertain.length > 0) flags.push("PARTLY_NOT_VISIBLE");

  return {
    ai_status: status,
    uncertainty_flags: flags,
    explanation,
    before_observations: before,
    after_observations: after,
    visible_changes: changes,
    not_visible_or_uncertain: uncertain,
  };
}

/** Without a before photo there is nothing to compare: decided without calling the model. */
export const MISSING_BEFORE: StoredVerification = {
  ai_status: "not_comparable",
  uncertainty_flags: ["MISSING_BEFORE"],
  explanation:
    "There is no before photo to compare with, so the repair cannot be checked from photos. A person should check it.",
  before_observations: [],
  after_observations: [],
  visible_changes: [],
  not_visible_or_uncertain: [],
};
