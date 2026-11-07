import { z } from "zod";

import { uploadRequestSchema } from "@/features/evidence/schemas";

export const REPAIR_EVIDENCE_KINDS = ["before", "after"] as const;
export type RepairEvidenceKind = (typeof REPAIR_EVIDENCE_KINDS)[number];

/** POST /api/cases/[id]/repair-evidence: a photo's kind plus the usual size and type. */
export const repairUploadRequestSchema = uploadRequestSchema.extend({
  kind: z.enum(REPAIR_EVIDENCE_KINDS, { error: "Choose a before or an after photo." }),
});

export type RepairUploadRequest = z.infer<typeof repairUploadRequestSchema>;

/** POST /api/cases/[id]/verification-decision (plan v2 §12). */
export const verificationDecisionSchema = z.strictObject({
  reviewId: z.uuid({ error: "The verification reference is invalid." }),
  confirm: z.boolean({ error: "Say whether the repair is confirmed." }),
  note: z.string().trim().max(1000, "Notes can be at most 1000 characters.").optional(),
});

export type VerificationDecision = z.infer<typeof verificationDecisionSchema>;

/** What finalize_repair_evidence_upload returns. */
export const finalizedRepairSchema = z.object({
  attachment_id: z.uuid(),
  review_id: z.uuid().nullable(),
  job_id: z.uuid().nullable(),
});

const AI_STATUSES = [
  "visually_improved",
  "possibly_unresolved",
  "inconclusive",
  "not_comparable",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

const STATES = ["pending", "awaiting_decision", "confirmed", "rework", "superseded"] as const;
export type ReviewState = (typeof STATES)[number];

const strings = z.array(z.string()).catch([]);

/** What repair_verification_view returns (validated: it is read from the database as JSON). */
export const verificationViewSchema = z.object({
  case_id: z.uuid(),
  reference: z.string(),
  case_status: z.string(),
  can_upload: z.boolean(),
  photos: z.array(
    z.object({
      attachment_id: z.uuid(),
      kind: z.enum(REPAIR_EVIDENCE_KINDS),
      object_path: z.string(),
      added_at: z.string(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: z.uuid(),
      state: z.enum(STATES),
      ai_status: z.enum(AI_STATUSES).nullable(),
      model: z.string().nullable(),
      prompt_version: z.string().nullable(),
      ai_result: z
        .object({
          before_observations: strings,
          after_observations: strings,
          visible_changes: strings,
          not_visible_or_uncertain: strings,
        })
        .nullable(),
      uncertainty_flags: z.array(z.string()),
      explanation: z.string().nullable(),
      analysed_at: z.string().nullable(),
      decided_at: z.string().nullable(),
      decision_note: z.string().nullable(),
      created_at: z.string(),
      before_source: z.enum(["report", "repair"]).nullable(),
      before_path: z.string().nullable(),
      after_path: z.string().nullable(),
    }),
  ),
});

export type VerificationViewRow = z.infer<typeof verificationViewSchema>;
