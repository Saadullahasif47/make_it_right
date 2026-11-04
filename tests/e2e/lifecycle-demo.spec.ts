/**
 * The homepage demonstration: one example ticket from report to closed. It plays once, can be
 * controlled step by step, pauses on request, and never moves for someone who asked for less
 * motion.
 */
import { expect, test, type Page } from "@playwright/test";

const demo = (page: Page) =>
  page.getByRole("region", { name: "Example: one ticket from report to closed" });
const currentStep = (page: Page) => demo(page).locator('[aria-current="step"]');

test("plays once from report to closed, then offers a replay", async ({ page }) => {
  await page.goto("/");
  // It waits until it is actually seen (below the fold on a phone), then starts from the report.
  await demo(page).scrollIntoViewIfNeeded();
  await expect(currentStep(page)).toHaveAccessibleName("Show step 1: Reported");
  await expect(currentStep(page)).toHaveAccessibleName("Show step 5: Closed", { timeout: 15_000 });
  await expect(demo(page).getByRole("button", { name: "Replay the example" })).toBeVisible();
  // The finished ticket's status is in place, and the hero never changed height while it played.
  await expect(demo(page).getByText("Closed", { exact: true }).first()).toBeVisible();
});

test("each step can be chosen directly, which stops the playback", async ({ page }) => {
  await page.goto("/");
  await demo(page).getByRole("button", { name: "Show step 2: Assigned" }).click();
  await expect(currentStep(page)).toHaveAccessibleName("Show step 2: Assigned");
  await expect(demo(page).getByRole("button", { name: "Play the example" })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(currentStep(page)).toHaveAccessibleName("Show step 2: Assigned");
  await expect(demo(page).locator("[aria-live=polite]")).toContainText(
    "Step 2 of 5: Assigned. Assigned to Electrical Maintenance.",
  );
});

test("with reduced motion it does not play, and shows the finished ticket", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(currentStep(page)).toHaveAccessibleName("Show step 5: Closed");
  await expect(demo(page).getByRole("button", { name: "Replay the example" })).toBeVisible();
});

test("the hero keeps its height while the example plays", async ({ page }) => {
  await page.goto("/");
  await demo(page).scrollIntoViewIfNeeded();
  // Layout height: offsetHeight ignores the scroll-reveal transform, which may still be running.
  const heightAt = async () =>
    demo(page).evaluate((element) => (element as HTMLElement).offsetHeight);
  await expect(currentStep(page)).toHaveAccessibleName("Show step 1: Reported");
  const start = await heightAt();
  await expect(currentStep(page)).toHaveAccessibleName("Show step 5: Closed", { timeout: 15_000 });
  expect(await heightAt()).toBe(start);
});
