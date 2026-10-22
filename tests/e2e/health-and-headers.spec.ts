import { expect, test } from "@playwright/test";

const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9]{16,64}$/;

test.describe("GET /api/health", () => {
  test("answers ok, uncached, with a request ID", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-request-id"]).toMatch(REQUEST_ID_PATTERN);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(["environment", "status", "version"]);
  });

  test("is evaluated per request rather than prerendered", async ({ request }) => {
    const first = await request.get("/api/health");
    const second = await request.get("/api/health");

    expect(first.headers()["x-request-id"]).not.toBe(second.headers()["x-request-id"]);
  });

  test("echoes a well-formed request ID and replaces a malformed one", async ({ request }) => {
    const valid = "req_0123456789abcdefABCDEF";
    const echoed = await request.get("/api/health", { headers: { "x-request-id": valid } });
    expect(echoed.headers()["x-request-id"]).toBe(valid);

    const forged = await request.get("/api/health", {
      headers: { "x-request-id": "req_<script>alert(1)</script>" },
    });
    expect(forged.headers()["x-request-id"]).toMatch(REQUEST_ID_PATTERN);
    expect(forged.headers()["x-request-id"]).not.toContain("script");
  });

  test("rejects methods it does not implement", async ({ request }) => {
    const response = await request.post("/api/health", { data: {} });
    expect(response.status()).toBe(405);
  });
});

test.describe("security headers", () => {
  for (const path of ["/", "/api/health"]) {
    test(`are present on ${path}`, async ({ request }) => {
      const headers = (await request.get(path)).headers();

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }
});
