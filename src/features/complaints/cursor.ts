import { z } from "zod";

/**
 * Opaque keyset cursor: the sort key of the last row on a page, i.e. (created_at, id) plus the
 * priority when a queue is sorted by urgency. It is decoded and strictly validated before use,
 * and passed to the database as typed RPC arguments, never as text inside a filter expression.
 */
export interface PageCursor {
  readonly createdAt: string;
  readonly id: string;
  readonly priority?: "unassessed" | "low" | "medium" | "high" | undefined;
}

const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  priority: z.enum(["unassessed", "low", "medium", "high"]).optional(),
});

const MAX_CURSOR_LENGTH = 256;

export function encodeCursor(cursor: PageCursor): string {
  const payload =
    cursor.priority === undefined
      ? { createdAt: cursor.createdAt, id: cursor.id }
      : { createdAt: cursor.createdAt, id: cursor.id, priority: cursor.priority };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
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
