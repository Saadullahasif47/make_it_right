import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a production build (`pnpm build` first) by default. Set
 * PLAYWRIGHT_BASE_URL to run the same suite against a deployed Vercel preview instead.
 */
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const isCI = process.env.CI === "true";
const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
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
      ? {
          command: `pnpm start --port ${port}`,
          url: `http://localhost:${port}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        }
      : undefined,
});
