import { JobError } from "../jobs/types.ts";

import { MAX_EVIDENCE_BYTES, sniffImageType } from "./image.ts";

const EVIDENCE_BUCKET = "complaint-evidence";

/** What the database recorded when the photo was finalised. */
export interface FinalizedPhoto {
  readonly object_path: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly sha256: string;
}

export interface StorageAccess {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly fetch: typeof fetch;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetches a private evidence photo with the service key and checks that its bytes are exactly
 * the photo that was finalised (size, real type, checksum), so a swapped object is never sent to
 * a model. Failures map to the shared job codes:
 *   STORAGE_UNAVAILABLE              retryable
 *   PHOTO_NOT_FOUND, PHOTO_INTEGRITY not retryable
 */
export async function downloadVerifiedPhoto(
  storage: StorageAccess,
  photo: FinalizedPhoto,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const objectUrl = `${storage.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${EVIDENCE_BUCKET}/${photo.object_path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  let download: Response;
  try {
    download = await storage.fetch(objectUrl, {
      headers: { apikey: storage.serviceKey, authorization: `Bearer ${storage.serviceKey}` },
      signal,
    });
  } catch (error) {
    throw new JobError("STORAGE_UNAVAILABLE", true, { cause: error });
  }
  if (download.status === 404 || download.status === 400) {
    throw new JobError("PHOTO_NOT_FOUND", false);
  }
  if (!download.ok) {
    throw new JobError("STORAGE_UNAVAILABLE", true);
  }

  const image = new Uint8Array(await download.arrayBuffer());
  if (
    image.byteLength > MAX_EVIDENCE_BYTES ||
    image.byteLength !== photo.byte_size ||
    sniffImageType(image) !== photo.mime_type ||
    (await sha256Hex(image)) !== photo.sha256
  ) {
    throw new JobError("PHOTO_INTEGRITY", false);
  }
  return image;
}
