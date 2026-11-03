import { afterEach, describe, expect, it, vi } from "vitest";

import { timed } from "@/lib/http/timed";
import * as logging from "@/lib/logging";
import { createLogger } from "@/lib/logging/logger";

const lines: { level: string; line: string }[] = [];

afterEach(() => {
  lines.length = 0;
});

function captureLogs() {
  vi.spyOn(logging, "getLogger").mockReturnValue(
    createLogger({ level: "debug", sink: (level, line) => lines.push({ level, line }) }),
  );
}

describe("timed", () => {
  it("logs route, status, request id and duration for every request, and nothing else", async () => {
    captureLogs();
    const handler = timed("POST /api/example", (_request: Request) =>
      Promise.resolve(
        Response.json(
          { secret: "complaint text" },
          { status: 201, headers: { "x-request-id": "req_abc" } },
        ),
      ),
    );

    const response = await handler(
      new Request("https://makeitright.test/api/example", {
        method: "POST",
        body: "Lights out in room 5",
      }),
    );

    expect(response.status).toBe(201);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]?.line ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "http.request",
      route: "POST /api/example",
      status: 201,
      requestId: "req_abc",
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(lines[0]?.line).not.toContain("Lights out");
    expect(lines[0]?.line).not.toContain("complaint text");
  });

  it("logs a failed request as an error with status 500 and still rethrows", async () => {
    captureLogs();
    const handler = timed("GET /api/broken", () => Promise.reject(new Error("boom")));

    await expect(handler(new Request("https://makeitright.test/api/broken"))).rejects.toThrow(
      "boom",
    );
    expect(lines).toEqual([expect.objectContaining({ level: "error" })]);
    expect(JSON.parse(lines[0]?.line ?? "{}")).toMatchObject({
      route: "GET /api/broken",
      status: 500,
    });
  });
});
