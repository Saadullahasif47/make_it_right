/**
 * Motion system (UI redesign plan §3, Stage 5 gate): short colour transitions by default, and
 * nothing that moves or waits once a visitor asks for reduced motion.
 */
import { expect, test, type Page } from "@playwright/test";

/** Longest transition and animation on the page, in milliseconds, and any hover transforms. */
const motionOf = (page: Page) =>
  page.evaluate(() => {
    const seconds = (value: string) =>
      Math.max(...value.split(",").map((part) => Number.parseFloat(part) || 0));
    let transition = 0;
    let animation = 0;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(element);
      transition = Math.max(transition, seconds(style.transitionDuration) * 1000);
      animation = Math.max(animation, seconds(style.animationDuration) * 1000);
    }
    return { transition, animation };
  });

for (const path of ["/", "/login"]) {
  test(`${path}: transitions stay short, and reduced motion makes them instant`, async ({
    page,
  }) => {
    await page.goto(path);
    const normal = await motionOf(page);
    // Nothing in the system is slower than the 250 ms drawer.
    expect(normal.transition).toBeGreaterThan(0);
    expect(normal.transition).toBeLessThanOrEqual(250);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const reduced = await motionOf(page);
    expect(reduced.transition).toBeLessThanOrEqual(0.01);
    expect(reduced.animation).toBeLessThanOrEqual(0.01);
    // Content never waits on an animation: the main heading is there at once.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 1000 });
  });
}
