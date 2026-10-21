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
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
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
