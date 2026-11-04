import { z } from "zod";

import { EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from "./image";

export const EVIDENCE_BUCKET = "complaint-evidence";

export const uploadRequestSchema = z.strictObject({
  mimeType: z.enum(EVIDENCE_MIME_TYPES, { error: "Choose a JPEG, PNG or WebP photo." }),
  byteSize: z
    .number({ error: "The photo size is missing." })
    .int()
    .min(1, "The photo is empty.")
    .max(MAX_EVIDENCE_BYTES, "Photos can be at most 2 MB."),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const finalizeRequestSchema = z.strictObject({
  attachmentId: z.uuid({ error: "The upload reference is invalid." }),
});

/** What request_evidence_upload returns. */
export const uploadSlotSchema = z.object({
  attachment_id: z.uuid(),
  object_path: z.string().min(1),
});

/** What finalize_evidence_upload returns. */
export const finalizedSchema = z.object({ attachment_id: z.uuid(), job_id: z.uuid().nullable() });
