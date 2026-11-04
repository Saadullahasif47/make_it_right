import "server-only";

import { createHash } from "node:crypto";

import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { EvidenceError, evidenceErrorFromDatabase } from "./errors";
import { MAX_EVIDENCE_BYTES, sniffImageType } from "./image";
import { EVIDENCE_BUCKET, finalizedSchema, uploadSlotSchema, type UploadRequest } from "./schemas";

export interface UploadSlot {
  readonly attachmentId: string;
  /** A one-time URL the browser PUTs the file to. It expires after two hours (Storage default). */
  readonly uploadUrl: string;
}

export interface FinalizedUpload {
  readonly attachmentId: string;
  readonly jobId: string | null;
}

/**
 * Reserves a photo for the caller's own complaint and returns a signed direct-upload URL. The
 * bytes go straight to the private bucket, never through this server. Everything runs as the
 * signed-in user, so RLS and the Storage policies decide what is allowed.
 */
export async function requestUpload(
  client: AppSupabaseClient,
  logger: Logger,
  complaintId: string,
  input: UploadRequest,
): Promise<UploadSlot> {
  const { data, error } = await client
    .rpc("request_evidence_upload", {
      p_complaint_id: complaintId,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
    })
    .single();
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  const slot = uploadSlotSchema.parse(data);

  const signed = await client.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(slot.object_path);
  if (signed.error !== null) {
    logger.error("evidence.upload_url_failed", { attachmentId: slot.attachment_id });
    await client.rpc("discard_evidence_upload", { p_attachment_id: slot.attachment_id });
    throw new EvidenceError("SERVICE_UNAVAILABLE", { cause: signed.error });
  }
  logger.info("evidence.upload_requested", { complaintId, attachmentId: slot.attachment_id });
  return { attachmentId: slot.attachment_id, uploadUrl: signed.data.signedUrl };
}

/** Rejects the upload and removes its object, so a bad file never stays in the bucket. */
async function reject(
  client: AppSupabaseClient,
  logger: Logger,
  attachmentId: string,
  objectPath: string,
  reason: string,
): Promise<never> {
  logger.warn("evidence.upload_rejected", { attachmentId, reason });
  await client.rpc("discard_evidence_upload", { p_attachment_id: attachmentId });
  await client.storage.from(EVIDENCE_BUCKET).remove([objectPath]);
  throw new EvidenceError("EVIDENCE_REJECTED");
}

/**
 * Checks the uploaded object byte by byte (size, real file signature, checksum), then
 * finalises it, which queues its visual analysis in the same transaction. Repeating the call
 * for a finalised photo returns the same job: the request is idempotent.
 */
export async function finalizeUpload(
  client: AppSupabaseClient,
  logger: Logger,
  complaintId: string,
  attachmentId: string,
): Promise<FinalizedUpload> {
  const { data: row, error } = await client
    .from("evidence_attachments")
    .select("id, complaint_id, object_path, mime_type, byte_size, state")
    .eq("id", attachmentId)
    .eq("complaint_id", complaintId)
    .maybeSingle();
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  if (row === null) {
    throw new EvidenceError("NOT_FOUND");
  }

  if (row.state === "pending") {
    const download = await client.storage.from(EVIDENCE_BUCKET).download(row.object_path);
    if (download.error !== null) {
      // Nothing was uploaded (an orphaned reference), or it is not ours to read.
      throw new EvidenceError("NOT_FOUND", { cause: download.error });
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (bytes.byteLength > MAX_EVIDENCE_BYTES || bytes.byteLength !== row.byte_size) {
      return reject(client, logger, row.id, row.object_path, "size_mismatch");
    }
    if (sniffImageType(bytes) !== row.mime_type) {
      return reject(client, logger, row.id, row.object_path, "type_mismatch");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return finalizeRow(client, logger, row, sha256, bytes.byteLength);
  }

  // Already finalised (a retry): the database returns the existing job without new work.
  return finalizeRow(client, logger, row, "0".repeat(64), row.byte_size);
}

async function finalizeRow(
  client: AppSupabaseClient,
  logger: Logger,
  row: { readonly id: string; readonly mime_type: string },
  sha256: string,
  byteSize: number,
): Promise<FinalizedUpload> {
  const { data, error } = await client
    .rpc("finalize_evidence_upload", {
      p_attachment_id: row.id,
      p_sha256: sha256,
      p_byte_size: byteSize,
      p_mime_type: row.mime_type,
    })
    .single();
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  const finalized = finalizedSchema.parse(data);
  logger.info("evidence.finalized", {
    attachmentId: finalized.attachment_id,
    jobId: finalized.job_id,
  });
  return { attachmentId: finalized.attachment_id, jobId: finalized.job_id };
}

export interface EvidencePhoto {
  readonly id: string;
  readonly createdAt: string;
  /** Short-lived signed URL; null if it could not be created. */
  readonly url: string | null;
}

/** The finalised photos of a complaint the caller can see, with five-minute signed URLs. */
export async function listPhotos(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<readonly EvidencePhoto[]> {
  const { data, error } = await client
    .from("evidence_attachments")
    .select("id, object_path, finalized_at")
    .eq("complaint_id", complaintId)
    .eq("state", "finalized")
    .order("finalized_at");
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  if (data.length === 0) {
    return [];
  }

  const signed = await client.storage.from(EVIDENCE_BUCKET).createSignedUrls(
    data.map((photo) => photo.object_path),
    300,
  );
  const urls = new Map(
    (signed.data ?? []).flatMap((entry) =>
      entry.error === null && entry.path !== null ? [[entry.path, entry.signedUrl] as const] : [],
    ),
  );
  return data.map((photo) => ({
    id: photo.id,
    createdAt: photo.finalized_at ?? "",
    url: urls.get(photo.object_path) ?? null,
  }));
}
