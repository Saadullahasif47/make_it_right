import { z } from "zod";

/**
 * Opaque keyset cursor: the (created_at, id) of the last row on a page. It is decoded and
 * strictly validated before use, and passed to the database as typed RPC arguments, never
 * as text inside a filter expression.
 */
export interface PageCursor {
  readonly createdAt: string;
  readonly id: string;
}

const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

const MAX_CURSOR_LENGTH = 256;

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })).toString(
    "base64url",
  );
}

/** Returns undefined for anything that is not a cursor we issued; callers start from page one. */
export function decodeCursor(raw: string | null | undefined): PageCursor | undefined {
  if (raw === null || raw === undefined || raw === "" || raw.length > MAX_CURSOR_LENGTH) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    return undefined;
  }
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
