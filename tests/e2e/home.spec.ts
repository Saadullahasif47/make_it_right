import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("public landing page", () => {
  test("loads with purpose, sign-in and the prototype disclaimer", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/MakeItRight/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("fixed right");
    await expect(page.getByRole("note", { name: "Prototype notice" })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /report an issue/i }),
    ).toHaveAttribute("href", "/student/complaints/new");
    expect(consoleErrors).toEqual([]);
  });

  test("has no detectable WCAG 2.1 AA violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  test("passes in dark mode too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/");

    const results = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("renders all content without needing to scroll (print, screenshots, no-JS readers)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const hidden = await page.locator("main :is(h2, h3, li)").evaluateAll((elements) =>
      elements
        .filter((element) => element.closest("[aria-hidden='true']") === null)
        .filter((element) => Number(getComputedStyle(element).opacity) < 1)
        .map((element) => element.textContent.trim().slice(0, 40)),
    );
    expect(hidden).toEqual([]);
  });

  test("never scrolls horizontally", async ({ page }) => {
    await page.goto("/");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("offers a skip link as the first keyboard stop", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("no link on the page leads to a missing route", async ({ page, request }) => {
    await page.goto("/");

    const hrefs = await page
      .locator("a[href^='/']")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const paths = [...new Set(hrefs.map((href) => href.split("#")[0] || "/"))];

    for (const path of paths) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });

  test("the sign-in call-to-action lands on a real page", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("link", { name: /report an issue/i })
      .click();

    await expect(page).toHaveURL(/\/login\?next=%2Fstudent%2Fcomplaints%2Fnew$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("in-page navigation reaches each section", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "See how it works" }).click();
    await expect(
      page.getByRole("heading", { name: "From report to resolved in three steps" }),
    ).toBeInViewport();
  });
});
