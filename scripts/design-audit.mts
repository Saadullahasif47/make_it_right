/**
 * Visual and accessibility audit of a deployment's public pages (UI redesign plan §6 stage gates).
 * For every page and width it saves a full-page screenshot, runs axe (WCAG 2.2 AA) and checks for
 * horizontal overflow. It signs nobody in and writes nothing, so it is safe against production.
 *
 *   pnpm design:audit --label after                                   # production
 *   pnpm design:audit --label before --base-url https://<preview>.vercel.app
 *
 * Screenshots land in test-results/design-audit/<label>/ (ignored by git); copy the ones worth
 * keeping into docs/design/stage-N/. Signed-in screens: scripts/design-audit-student.mts.
 */
import { parseArgs } from "node:util";

import { parseWidths, runAudit } from "./lib/design-audit.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://makeitright-takeasy1.vercel.app" },
    label: { type: "string", default: "after" },
    pages: { type: "string", default: "/,/login,/signup,/forgot-password" },
    widths: { type: "string", default: "390,768,1366,1440" },
    "dark-widths": { type: "string", default: "390,1440" },
  },
});

/** "/" → "landing", "/forgot-password" → "forgot-password". */
const pageName = (path: string) => path.replace(/^\//, "").replaceAll("/", "-") || "landing";

runAudit({
  baseUrl: options["base-url"].replace(/\/+$/, ""),
  label: options.label,
  pages: options.pages.split(",").map((path) => ({ path, name: pageName(path) })),
  widths: parseWidths(options.widths),
  darkWidths: parseWidths(options["dark-widths"]),
})
  .then((clean) => {
    if (!clean) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
