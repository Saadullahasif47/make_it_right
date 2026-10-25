import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Next.js resolves `server-only` itself; under Vitest it would throw on import.
const serverOnlyStub = fileURLToPath(new URL("./tests/support/empty-module.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    restoreMocks: true,
    unstubEnvs: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // Needs the local Supabase stack (`pnpm db:start`); run with `pnpm test:integration`.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/support/load-env.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        // Live model evaluation (P4.09): opt-in, uses the free-tier quota. `pnpm eval:agent`.
        extends: true,
        test: {
          name: "eval",
          environment: "node",
          include: ["tests/eval/**/*.eval.ts"],
          setupFiles: ["./tests/integration/support/load-env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
          setupFiles: ["./tests/support/setup-dom.ts"],
        },
      },
    ],
  },
});
