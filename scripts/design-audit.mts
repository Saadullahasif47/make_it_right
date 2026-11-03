/**
 * Visual and accessibility audit of a deployment's public pages (UI redesign plan §6 stage gates).
 * For every page and width it saves a full-page screenshot, runs axe (WCAG 2.2 AA) and checks for
 * horizontal overflow. It signs nobody in and writes nothing, so it is safe against production.
 *
 *   pnpm design:audit --label after                                   # production
 *   pnpm design:audit --label before --base-url https://<preview>.vercel.app
 *
 * Screenshots land in test-results/design-audit/<label>/ (ignored by git); copy the ones worth
 * keeping into docs/design/stage-N/.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://makeitright-takeasy1.vercel.app" },
    label: { type: "string", default: "after" },
    pages: { type: "string", default: "/,/login,/signup,/forgot-password" },
    widths: { type: "string", default: "390,768,1366,1440" },
    "dark-widths": { type: "string", default: "390,1440" },
  },
});
const baseUrl = options["base-url"].replace(/\/+$/, "");
const outDir = join("test-results", "design-audit", options.label);
const pages = options.pages.split(",");
const widths = (list: string) => list.split(",").filter(Boolean).map(Number);

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** "/" → "landing", "/forgot-password" → "forgot-password". */
const pageName = (path: string) => path.replace(/^\//, "").replaceAll("/", "-") || "landing";

interface Result {
  readonly shot: string;
  readonly violations: readonly string[];
  readonly overflow: boolean;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const runs = [
    ...widths(options.widths).map((width) => ({ width, scheme: "light" as const })),
    ...widths(options["dark-widths"]).map((width) => ({ width, scheme: "dark" as const })),
  ];
  const results: Result[] = [];

  try {
    for (const { width, scheme } of runs) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 844 : 900 },
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (const path of pages) {
        await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
        const shot = `${pageName(path)}-${width}${scheme === "dark" ? "-dark" : ""}.png`;
        await page.screenshot({ path: join(outDir, shot), fullPage: true });

        const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        results.push({
          shot,
          violations: axe.violations.map((item) => `${item.id} (${item.nodes.length})`),
          overflow,
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => item.violations.length > 0 || item.overflow);
  for (const item of results) {
    const problems = [...item.violations, ...(item.overflow ? ["horizontal overflow"] : [])];
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${item.shot}  ${problems.join(", ")}`);
  }
  console.log(
    `\n${results.length - failed.length} / ${results.length} screens clean against ${baseUrl}; screenshots in ${outDir}`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
