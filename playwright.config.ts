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
/** A second server with AI switched on, talking to the local Gemini stub (tests/e2e/agent.spec.ts). */
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
            command: `node tests/support/gemini-stub.mts ${GEMINI_STUB_PORT}`,
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
            },
          },
        ]
      : undefined,
});
