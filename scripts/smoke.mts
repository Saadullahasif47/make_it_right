/**
 * Read-only release smoke test of a deployment (master plan P7.05, P7.06 and the release gate).
 * It signs nobody in and writes nothing, so it is safe against production at any time.
 *
 *   pnpm smoke                                   # production, expects the current git commit
 *   pnpm smoke --base-url https://<preview>.vercel.app --expect-sha 1a2b3c4
 *
 * The signed-in journeys (submit, route, resolve, close) are covered by the E2E suite and the
 * rehearsed demo; see docs/runbooks/release.md.
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://makeitright-takeasy1.vercel.app" },
    "expect-sha": { type: "string" },
  },
});
const baseUrl = options["base-url"].replace(/\/+$/, "");
const expectedSha =
  options["expect-sha"] ??
  execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

const get = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, { redirect: "manual", cache: "no-store", ...init });

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
};

async function main() {
  // The deployed version is the commit we expect.
  const healthResponse = await get("/api/health");
  const health = (await healthResponse.json()) as {
    status?: string;
    version?: string;
    environment?: string;
  };
  check(
    "health endpoint answers ok",
    healthResponse.status === 200 && health.status === "ok",
    `HTTP ${healthResponse.status}`,
  );
  check(
    "deployed commit equals the expected commit",
    health.version !== undefined && expectedSha.startsWith(health.version.slice(0, 7)),
    `deployed ${health.version}, expected ${expectedSha}`,
  );
  check("environment is reported", typeof health.environment === "string", `${health.environment}`);

  // Public pages render, with the hardening headers.
  for (const path of ["/", "/login", "/signup", "/forgot-password"]) {
    const response = await get(path);
    const missing = Object.entries(SECURITY_HEADERS)
      .filter(([name, value]) => response.headers.get(name) !== value)
      .map(([name]) => name);
    check(`${path} renders`, response.status === 200, `HTTP ${response.status}`);
    check(
      `${path} sends the security headers`,
      missing.length === 0,
      missing.length === 0 ? "all present" : `missing ${missing.join(", ")}`,
    );
    check(
      `${path} does not advertise the framework`,
      response.headers.get("x-powered-by") === null,
      `${response.headers.get("x-powered-by")}`,
    );
  }

  // Every signed-in area sends visitors to sign in, remembering where they were going.
  for (const path of [
    "/student/complaints",
    "/student/complaints/new",
    "/department",
    "/admin",
    "/admin/review",
    "/admin/departments",
  ]) {
    const response = await get(path);
    const location = response.headers.get("location") ?? "";
    check(
      `${path} redirects a visitor to sign in`,
      response.status === 307 && location.includes(`/login?next=${encodeURIComponent(path)}`),
      `HTTP ${response.status} → ${location.replace(baseUrl, "")}`,
    );
  }

  // The API refuses anonymous callers, without caching, and with a request id.
  const someId = "00000000-0000-4000-8000-000000000000";
  const anonymous: [string, string][] = [
    ["GET", "/api/complaints"],
    ["GET", `/api/complaints/${someId}`],
    ["GET", "/api/admin/metrics"],
    ["POST", "/api/complaints"],
    ["PATCH", `/api/complaints/${someId}/status`],
  ];
  for (const [method, path] of anonymous) {
    const response = await get(path, {
      method,
      headers: { "content-type": "application/json", origin: baseUrl },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    const body = (await response.json()) as { error?: { code?: string } };
    check(
      `${method} ${path.replace(someId, ":id")} refuses an anonymous caller`,
      response.status === 401 &&
        body.error?.code === "UNAUTHENTICATED" &&
        (response.headers.get("cache-control") ?? "").includes("no-store") &&
        (response.headers.get("x-request-id") ?? "") !== "",
      `HTTP ${response.status} ${body.error?.code}`,
    );
  }

  // A browser request from another site cannot submit a complaint.
  const crossSite = await get("/api/complaints", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: "{}",
  });
  check("a cross-site submission is refused", crossSite.status === 403, `HTTP ${crossSite.status}`);

  const failed = checks.filter((item) => !item.ok);
  for (const item of checks)
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
  console.log(
    `\n${checks.length - failed.length} / ${checks.length} checks passed against ${baseUrl}`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
