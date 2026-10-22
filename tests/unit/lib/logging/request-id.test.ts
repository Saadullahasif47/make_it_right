import { describe, expect, it } from "vitest";

import {
  REQUEST_ID_HEADER,
  createRequestId,
  isRequestId,
  resolveRequestId,
} from "@/lib/logging/request-id";

describe("request IDs", () => {
  it("creates unique IDs in the req_ format", () => {
    const ids = new Set(Array.from({ length: 500 }, createRequestId));

    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(isRequestId(id)).toBe(true);
    }
  });

  it("reuses a well-formed inbound request ID", () => {
    const inbound = createRequestId();
    const headers = new Headers({ [REQUEST_ID_HEADER]: inbound });

    expect(resolveRequestId(headers)).toBe(inbound);
  });

  it.each([
    ["missing prefix", "abcdef0123456789abcdef"],
    ["too short", "req_abc"],
    ["log injection attempt", 'req_abcdef0123456789\n{"level":"error"}'],
    ["unexpected characters", "req_abcdef0123456789-<script>"],
    ["too long", `req_${"a".repeat(65)}`],
  ])("replaces an inbound ID that is %s", (_label, inbound) => {
    const headers = new Headers();
    try {
      headers.set(REQUEST_ID_HEADER, inbound);
    } catch {
      // Headers refuses raw newlines; that is equivalent to the header being absent.
    }

    const resolved = resolveRequestId(headers);
    expect(resolved).not.toBe(inbound);
    expect(isRequestId(resolved)).toBe(true);
  });

  it("issues a fresh ID when the header is absent", () => {
    expect(isRequestId(resolveRequestId(new Headers()))).toBe(true);
  });
});
