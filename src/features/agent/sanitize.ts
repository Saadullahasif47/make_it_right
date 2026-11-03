/**
 * Minimum-necessary complaint text for the model (plan §8): personal identifiers are
 * replaced with placeholders, markup that could fake the prompt's delimiters is removed,
 * and the length is capped. The stored complaint is never modified.
 */
export const MODEL_TEXT_LIMITS = { title: 120, description: 2000 } as const;

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "[link]"],
  // Student and staff ids: 8+ digits in a row, alone or after a short letter prefix.
  [/\b[A-Za-z]{0,3}\d{8,}\b/g, "[id]"],
  // Phone numbers: 7+ digits, optionally with a leading + and common separators.
  [/(?:\+?\d[\s().-]?){7,}\d/g, "[phone]"],
];

// Control and invisible formatting characters (zero-width, bidi overrides), keeping newlines.
const INVISIBLE_CHARACTERS = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function sanitizeForModel(text: string, maxLength: number): string {
  let result = text.normalize("NFKC").replace(/\t/g, " ").replace(INVISIBLE_CHARACTERS, "");
  for (const [pattern, placeholder] of REDACTIONS) {
    result = result.replace(pattern, placeholder);
  }
  result = result
    .replace(/[<>]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result.length > maxLength ? `${result.slice(0, maxLength - 1).trimEnd()}…` : result;
}

/** A model-written reason, before it is stored on the timeline that the reporter reads. */
export function sanitizeReason(reason: string): string {
  return sanitizeForModel(reason.replace(/\s+/g, " "), 280);
}
