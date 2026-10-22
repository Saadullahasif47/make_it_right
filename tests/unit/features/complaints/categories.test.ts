import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABELS,
  COMPLAINT_CATEGORIES,
  isComplaintCategory,
} from "@/features/complaints/categories";

describe("complaint categories", () => {
  it("matches exactly the six MVP categories from master plan §1", () => {
    expect(COMPLAINT_CATEGORIES).toEqual([
      "electrical",
      "it_equipment",
      "plumbing",
      "furniture",
      "sanitation",
      "other",
    ]);
  });

  it("has a non-empty label for every category", () => {
    for (const category of COMPLAINT_CATEGORIES) {
      expect(CATEGORY_LABELS[category].trim()).not.toBe("");
    }
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(COMPLAINT_CATEGORIES.length);
  });

  it.each(["electrical", "other"])("accepts %s", (value) => {
    expect(isComplaintCategory(value)).toBe(true);
  });

  it.each(["Electrical", "unclassified", "hvac", "", "__proto__"])("rejects %j", (value) => {
    expect(isComplaintCategory(value)).toBe(false);
  });
});
