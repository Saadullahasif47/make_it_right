import type { z } from "zod";

/**
 * Result of a server action that backs a form. Non-secret field values are echoed back so the
 * form can be re-filled after an error; passwords never are.
 */
export interface FormState<Field extends string = string> {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<Field, string>>;
  readonly values?: Partial<Record<Field, string>>;
}

export const IDLE_FORM_STATE: FormState<never> = { status: "idle" };

/** First validation message per field, in the shape forms render. */
export function fieldErrorsFrom<Field extends string>(
  error: z.ZodError,
): Partial<Record<Field, string>> {
  const result: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in result)) {
      result[field as Field] = issue.message;
    }
  }
  return result;
}

/** Reads string fields from FormData; files and missing fields become undefined. */
export function readFields<Field extends string>(
  formData: FormData,
  fields: readonly Field[],
): Partial<Record<Field, string>> {
  const result: Partial<Record<Field, string>> = {};
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value === "string") {
      result[field] = value;
    }
  }
  return result;
}
