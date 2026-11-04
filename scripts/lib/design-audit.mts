/**
 * Shared engine of the design audits (UI redesign plan §6 stage gates): for every page and width
 * it saves a full-page screenshot, runs axe (WCAG 2.2 AA) and checks for horizontal overflow.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface AuditPage {
  readonly path: string;
  /** File-name stem of its screenshots, for example "student-list". */
  readonly name: string;
}

export interface AuditOptions {
  readonly baseUrl: string;
  readonly label: string;
  readonly pages: readonly AuditPage[];
  readonly widths: readonly number[];
  readonly darkWidths: readonly number[];
  /** Runs in each fresh browser context before its first page, for example to sign in. */
  readonly prepare?: (page: Page) => Promise<void>;
}

interface Result {
  readonly shot: string;
  readonly violations: readonly string[];
  readonly overflow: boolean;
}

/** "1440,390" → [1440, 390]. */
export const parseWidths = (list: string): number[] => list.split(",").filter(Boolean).map(Number);

/** Prints one line per screen and returns whether every screen was clean. */
export async function runAudit(options: AuditOptions): Promise<boolean> {
  const outDir = join("test-results", "design-audit", options.label);
  await mkdir(outDir, { recursive: true });
  const runs = [
    ...options.widths.map((width) => ({ width, scheme: "light" as const })),
    ...options.darkWidths.map((width) => ({ width, scheme: "dark" as const })),
  ];
  const results: Result[] = [];

  const browser = await chromium.launch();
  try {
    for (const { width, scheme } of runs) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 844 : 900 },
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      // Dark is an opt-in theme (src/components/theme), so choose it the way a person does.
      if (scheme === "dark") {
        await context.addInitScript(() => {
          localStorage.setItem("mir-theme", "dark");
        });
      }
      const page = await context.newPage();
      await options.prepare?.(page);
      for (const { path, name } of options.pages) {
        await page.goto(`${options.baseUrl}${path}`, { waitUntil: "networkidle" });
        const shot = `${name}-${width}${scheme === "dark" ? "-dark" : ""}.png`;
        await page.screenshot({ path: join(outDir, shot), fullPage: true });

        const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        results.push({
          shot,
          violations: axe.violations.map(
            (item) =>
              `${item.id} (${item.nodes.length}, first: ${String(item.nodes[0]?.target[0])})`,
          ),
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
    `\n${results.length - failed.length} / ${results.length} screens clean against ${options.baseUrl}; screenshots in ${outDir}`,
  );
  return failed.length === 0;
}
