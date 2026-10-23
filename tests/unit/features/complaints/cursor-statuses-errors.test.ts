import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "@/features/complaints/cursor";
import { complaintErrorFromDatabase } from "@/features/complaints/errors";
import {
  STATUS_FILTERS,
  STATUS_LABELS,
  STATUS_TONES,
  TICKET_STATES,
  formatReference,
  isStatusFilter,
} from "@/features/complaints/statuses";

describe("page cursor", () => {
  const cursor = {
    createdAt: "2026-10-23T09:15:00.123456+00:00",
    id: "0b7a6e00-0000-4000-8000-000000000001",
  };

  it("round-trips", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  const forge = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it.each([
    ["empty", ""],
    ["not base64url", "not a cursor!"],
    ["not JSON", Buffer.from("hello").toString("base64url")],
    ["bad timestamp", forge({ createdAt: "yesterday", id: cursor.id })],
    ["bad id", forge({ createdAt: cursor.createdAt, id: "1 OR 1=1" })],
    [
      "filter injection attempt",
      forge({ createdAt: "2026-10-23T09:15:00Z),id.gt.(0", id: cursor.id }),
    ],
    ["extra fields", forge({ ...cursor, role: "admin" })],
    ["oversized", "a".repeat(300)],
  ])("rejects a cursor that is %s", (_label, raw) => {
    expect(decodeCursor(raw)).toBeUndefined();
  });

  it("treats a missing cursor as the first page", () => {
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});

describe("ticket statuses", () => {
  it("label and tone every state", () => {
    for (const state of TICKET_STATES) {
      expect(STATUS_LABELS[state].length).toBeGreaterThan(0);
      expect(STATUS_TONES[state]).toBeDefined();
    }
  });

  it("filters only reference real states, and open excludes finished tickets", () => {
    for (const filter of Object.values(STATUS_FILTERS)) {
      for (const state of filter.states ?? []) {
        expect(TICKET_STATES).toContain(state);
      }
    }
    expect(STATUS_FILTERS.open.states).not.toContain("resolved");
    expect(STATUS_FILTERS.open.states).not.toContain("closed");
    expect(STATUS_FILTERS.all.states).toBeNull();
  });

  it("recognises only known filter names", () => {
    expect(isStatusFilter("open")).toBe(true);
    expect(isStatusFilter("constructor")).toBe(false);
    expect(isStatusFilter("__proto__")).toBe(false);
    expect(isStatusFilter(undefined)).toBe(false);
  });

  it("formats references", () => {
    expect(formatReference(1001)).toBe("MIR-1001");
  });
});

describe("database error mapping", () => {
  it.each([
    ["42501", "UNAUTHENTICATED"],
    ["MR429", "RATE_LIMITED"],
    ["MR409", "IDEMPOTENCY_CONFLICT"],
    ["23514", "VALIDATION_FAILED"],
    ["22004", "VALIDATION_FAILED"],
    ["22P02", "VALIDATION_FAILED"],
    ["08006", "SERVICE_UNAVAILABLE"],
    [undefined, "SERVICE_UNAVAILABLE"],
  ])("maps SQLSTATE %s to %s", (code, expected) => {
    expect(complaintErrorFromDatabase(code === undefined ? {} : { code }).code).toBe(expected);
  });

  it("never exposes the database message", () => {
    const databaseError = {
      code: "23514",
      message: 'new row violates check "complaints_title_length"',
    };
    const error = complaintErrorFromDatabase(databaseError);
    expect(error.message).toBe("VALIDATION_FAILED");
    expect(error.message).not.toContain("complaints_title_length");
  });
});
