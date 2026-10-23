import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPLAINT_LIMITS,
  complaintInputSchema,
  pageSizeSchema,
} from "@/features/complaints/schemas";

const valid = {
  title: "Ceiling fan not working",
  description: "The ceiling fan in room 214 stopped spinning this morning.",
  building: "Block C",
  room: "214",
};

describe("complaintInputSchema", () => {
  it("accepts a valid complaint and trims every field", () => {
    expect(
      complaintInputSchema.parse({
        title: `  ${valid.title} `,
        description: `${valid.description}  `,
        building: " Block C",
        room: " 214 ",
      }),
    ).toEqual(valid);
  });

  it("treats an empty room as not provided", () => {
    expect(complaintInputSchema.parse({ ...valid, room: "   " }).room).toBeUndefined();
    expect(complaintInputSchema.parse({ ...valid, room: undefined }).room).toBeUndefined();
  });

  it("keeps line breaks in the description", () => {
    const description = "Line one of the report.\nLine two with\tdetail.";
    expect(complaintInputSchema.parse({ ...valid, description }).description).toBe(description);
  });

  it.each(["status", "category", "priority", "created_by", "assigned_department_id", "version"])(
    "rejects an injected %s field (P2.09)",
    (field) => {
      expect(complaintInputSchema.safeParse({ ...valid, [field]: "resolved" }).success).toBe(false);
    },
  );

  it.each([
    ["title", "Fan"],
    ["title", "x".repeat(121)],
    ["description", "Too short"],
    ["description", "x".repeat(3001)],
    ["building", "A"],
    ["room", "x".repeat(41)],
  ] as const)("rejects %s outside its limits", (field, value) => {
    expect(complaintInputSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("measures limits after trimming", () => {
    expect(complaintInputSchema.safeParse({ ...valid, title: "   Fan   " }).success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(complaintInputSchema.safeParse({ ...valid, title: "Fan\u0000broken" }).success).toBe(
      false,
    );
    expect(
      complaintInputSchema.safeParse({ ...valid, description: `${valid.description}\u0007` })
        .success,
    ).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(complaintInputSchema.safeParse({ ...valid, title: 12345 }).success).toBe(false);
    expect(complaintInputSchema.safeParse(null).success).toBe(false);
  });
});

describe("limits stay in sync with the database", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n");

  it.each(Object.entries(COMPLAINT_LIMITS))("%s matches its check constraint", (field, limits) => {
    const pattern = new RegExp(
      `char_length\\(btrim\\(${field}\\)\\) between ${limits.min} and ${limits.max}`,
    );
    expect(sql, `no check constraint "${field} between ${limits.min} and ${limits.max}"`).toMatch(
      pattern,
    );
  });
});

describe("pageSizeSchema", () => {
  it("defaults to 20 and accepts 1-50", () => {
    expect(pageSizeSchema.parse(undefined)).toBe(20);
    expect(pageSizeSchema.parse("50")).toBe(50);
  });

  it.each(["0", "51", "2.5", "abc", "-1"])("rejects %s", (value) => {
    expect(pageSizeSchema.safeParse(value).success).toBe(false);
  });
});
