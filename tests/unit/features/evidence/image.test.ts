import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_PHOTOS_PER_COMPLAINT,
  sniffImageType,
} from "@/features/evidence/image";
import { finalizeRequestSchema, uploadRequestSchema } from "@/features/evidence/schemas";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("rejects anything else, whatever its name or declared type", () => {
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(
      sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20])),
    ).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("upload requests", () => {
  it("accepts an allowed type up to 2 MB", () => {
    expect(
      uploadRequestSchema.safeParse({ mimeType: "image/webp", byteSize: MAX_EVIDENCE_BYTES })
        .success,
    ).toBe(true);
  });

  it.each([
    [{ mimeType: "image/gif", byteSize: 10 }],
    [{ mimeType: "image/png", byteSize: MAX_EVIDENCE_BYTES + 1 }],
    [{ mimeType: "image/png", byteSize: 0 }],
    [{ mimeType: "image/png", byteSize: 1.5 }],
    [{ mimeType: "image/png", byteSize: 10, objectPath: "../../etc/passwd" }],
  ])("refuses %j", (input) => {
    expect(uploadRequestSchema.safeParse(input).success).toBe(false);
  });

  it("finalises only by attachment id", () => {
    expect(finalizeRequestSchema.safeParse({ attachmentId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("limits match the database", () => {
  const migrations = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(migrations)
    .map((file) => readFileSync(join(migrations, file), "utf8"))
    .join("\n");

  it("uses the same size cap, types and photo limit as the bucket and SQL functions", () => {
    expect(sql).toContain(`byte_size between 1 and ${String(MAX_EVIDENCE_BYTES)}`);
    expect(sql).toContain(`'complaint-evidence', false, ${String(MAX_EVIDENCE_BYTES)}`);
    expect(sql).toContain(`array[${EVIDENCE_MIME_TYPES.map((type) => `'${type}'`).join(", ")}]`);
    expect(sql).toContain(`and a.state <> 'rejected') >= ${String(MAX_PHOTOS_PER_COMPLAINT)}`);
  });
});
