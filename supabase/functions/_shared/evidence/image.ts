/**
 * Photo evidence rules (plan v2 F1.01), shared by the browser form, the server check and the
 * AI worker.
 * The database enforces the same allowlist and 2 MiB cap; tests keep the three in step.
 */
export const EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

/** Photos per complaint (also enforced in request_evidence_upload). */
export const MAX_PHOTOS_PER_COMPLAINT = 5;

export function isEvidenceMimeType(value: string): value is EvidenceMimeType {
  return (EVIDENCE_MIME_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * The image type the bytes actually are, from their file signature, or null for anything
 * else. A declared Content-Type is never trusted on its own.
 */
export function sniffImageType(bytes: Uint8Array): EvidenceMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}
