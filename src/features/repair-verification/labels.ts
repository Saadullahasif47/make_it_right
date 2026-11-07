/** Plain-language labels for repair verification (plan v2 F4). */
import type { AiStatus, RepairEvidenceKind, ReviewState } from "./schemas";

export const AI_STATUS_LABELS: Readonly<
  Record<AiStatus, { readonly label: string; readonly meaning: string; readonly tone: string }>
> = {
  visually_improved: {
    label: "Looks improved",
    meaning: "The visible signs of the problem appear reduced. Whether it works is not known.",
    tone: "bg-success-soft text-success",
  },
  possibly_unresolved: {
    label: "May not be fixed",
    meaning: "Visible signs of the problem remain in the after photo.",
    tone: "bg-accent-soft text-accent-ink",
  },
  inconclusive: {
    label: "Inconclusive",
    meaning:
      "Angle, lighting or framing prevents a fair comparison. A better photo or a visit helps.",
    tone: "bg-surface-muted text-ink-muted",
  },
  not_comparable: {
    label: "Not comparable",
    meaning: "The photos show different places or objects, or there is no before photo.",
    tone: "bg-surface-muted text-ink-muted",
  },
};

export const STATE_LABELS: Readonly<Record<ReviewState, string>> = {
  pending: "Comparing the photos…",
  awaiting_decision: "Waiting for a person to decide",
  confirmed: "Repair confirmed by a person",
  rework: "Sent back for more work",
  superseded: "No longer needed",
};

export const KIND_LABELS: Readonly<Record<RepairEvidenceKind, string>> = {
  before: "Before repair",
  after: "After repair",
};

const FLAG_LABELS: Readonly<Record<string, string>> = {
  MISSING_BEFORE: "No before photo",
  DIFFERENT_SCENE: "Different place or object",
  SCENE_UNCLEAR: "Unclear if it is the same place",
  BEFORE_BLURRY: "Before photo blurry",
  BEFORE_DARK: "Before photo too dark",
  AFTER_BLURRY: "After photo blurry",
  AFTER_DARK: "After photo too dark",
  OVERCLAIM: "Wording claimed too much",
  PARTLY_NOT_VISIBLE: "Some things cannot be seen",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}
