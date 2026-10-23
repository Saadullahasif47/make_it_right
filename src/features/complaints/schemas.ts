import { z } from "zod";

/**
 * Field limits for a complaint. The same numbers are enforced by check constraints in
 * supabase/migrations (a unit test keeps the two in sync), so Zod gives friendly messages and
 * the database remains the final guard.
 */
export const COMPLAINT_LIMITS = {
  title: { min: 5, max: 120 },
  description: { min: 15, max: 3000 },
  building: { min: 2, max: 80 },
  room: { min: 1, max: 40 },
} as const;

const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]*$/u;
/** Multi-line text may keep line breaks and tabs, but no other control characters. */
const NO_CONTROL_EXCEPT_WHITESPACE = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;

function boundedText(field: keyof typeof COMPLAINT_LIMITS, label: string, multiLine = false) {
  const { min, max } = COMPLAINT_LIMITS[field];
  return z
    .string()
    .trim()
    .min(min, `${label} needs at least ${min} characters.`)
    .max(max, `${label} can be at most ${max} characters.`)
    .regex(
      multiLine ? NO_CONTROL_EXCEPT_WHITESPACE : NO_CONTROL_CHARACTERS,
      "Remove unsupported characters.",
    );
}

/**
 * What a student may submit. strictObject rejects any extra field (status, category,
 * created_by, …) instead of silently dropping it: injected fields are an error, not a no-op.
 */
export const complaintInputSchema = z.strictObject({
  title: boundedText("title", "Title"),
  description: boundedText("description", "Description", true),
  building: boundedText("building", "Building"),
  room: z
    .string()
    .trim()
    .max(COMPLAINT_LIMITS.room.max, `Room can be at most ${COMPLAINT_LIMITS.room.max} characters.`)
    .regex(NO_CONTROL_CHARACTERS, "Remove unsupported characters.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

export type ComplaintInput = z.infer<typeof complaintInputSchema>;

export const idempotencyKeySchema = z.uuid("A valid submission key is required.");

export const complaintIdSchema = z.uuid();

export const PAGE_SIZE = { default: 20, max: 50 } as const;

export const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGE_SIZE.max)
  .default(PAGE_SIZE.default);
