import { describe, expect, it } from "vitest";

import { API_ERRORS, apiErrorResponse, type ApiErrorCode } from "@/lib/http/api-error";

const REQUEST_ID = "req_0123456789abcdef0123";

describe("API error catalog", () => {
  it("covers every status the API contract in master plan §11 relies on", () => {
    const statuses = new Set(Object.values(API_ERRORS).map((entry) => entry.status));
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      expect(statuses).toContain(status);
    }
  });

  it("uses the plan's STALE_VERSION wording for optimistic-lock conflicts", () => {
    expect(API_ERRORS.STALE_VERSION).toEqual({
      status: 409,
      message: "This ticket changed. Refresh and try again.",
    });
  });
});

describe("apiErrorResponse", () => {
  const codes = Object.keys(API_ERRORS) as ApiErrorCode[];

  it.each(codes)("builds the standard error body for %s", async (code) => {
    const response = apiErrorResponse(code, REQUEST_ID);

    expect(response.status).toBe(API_ERRORS[code].status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: { code, message: API_ERRORS[code].message, requestId: REQUEST_ID },
    });
  });
});
