import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Developers keep the local stack's variables in .env.local; CI exports them directly.
if (process.env.SUPABASE_SECRET_KEY === undefined && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

/**
 * E2E runs against a production build (`pnpm build` first) by default. Set
 * PLAYWRIGHT_BASE_URL to run the same suite against a deployed Vercel preview instead.
 */
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const isCI = process.env.CI === "true";
const port = 3100;
/** A second server with AI and the add-on features switched on, talking to the local Gemini stub. */
export const AI_PORT = 3101;
const GEMINI_STUB_PORT = 3199;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Each worker drives a browser against Docker Supabase and one Next server; keep it modest.
  workers: isCI ? 2 : 3,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer:
    externalBaseUrl === undefined
      ? [
          {
            command: `pnpm start --port ${port}`,
            url: `http://localhost:${port}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
            // Links in emails must point at this test server. AI stays off: the P1-P3 journeys
            // run exactly as a deployment without a provider would.
            env: { APP_BASE_URL: `http://localhost:${port}`, AI_ENABLED: "false" },
          },
          {
            // CI's Linux Docker reaches the host only through the bridge gateway (see the stub).
            command: `node tests/support/gemini-stub.mts ${GEMINI_STUB_PORT} ${isCI ? "0.0.0.0" : "127.0.0.1"}`,
            url: `http://127.0.0.1:${GEMINI_STUB_PORT}/health`,
            reuseExistingServer: !isCI,
            timeout: 30_000,
          },
          {
            command: `pnpm start --port ${AI_PORT}`,
            url: `http://localhost:${AI_PORT}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
            env: {
              APP_BASE_URL: `http://localhost:${AI_PORT}`,
              AI_ENABLED: "true",
              GEMINI_API_KEY: "stub-key-not-a-secret",
              GEMINI_MODEL: "gemini-3.1-flash-lite",
              GEMINI_BASE_URL: `http://127.0.0.1:${GEMINI_STUB_PORT}`,
              AI_TIMEOUT_MS: "3000",
              // Add-on features under test run here; the first server keeps every flag OFF, so
              // its journeys also prove that switched-off features stay invisible (plan v2 A0.02).
              FEATURE_VISUAL_INSPECTION: "true",
              FEATURE_DUPLICATE_DETECTION: "true",
              FEATURE_MAINTENANCE_COORDINATOR: "true",
              FEATURE_REPAIR_VERIFICATION: "true",
            },
          },
        ]
      : undefined,
});
