/**
 * The six facilities categories in MVP scope (master plan §1). This list is the single
 * source of truth for UI labels, validation schemas and, later, the database enum.
 */
export const COMPLAINT_CATEGORIES = [
  "electrical",
  "it_equipment",
  "plumbing",
  "furniture",
  "sanitation",
  "other",
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<ComplaintCategory, string>> = {
  electrical: "Electrical",
  it_equipment: "IT equipment",
  plumbing: "Plumbing",
  furniture: "Furniture",
  sanitation: "Sanitation",
  other: "Other",
};

export function isComplaintCategory(value: string): value is ComplaintCategory {
  return (COMPLAINT_CATEGORIES as readonly string[]).includes(value);
}
