/**
 * Motion system (docs/design/motion.md): short transitions on cheap properties with the shared
 * curves, only the system's own keyframes, and nothing that moves or waits under reduced motion.
 */
import { expect, test, type Page } from "@playwright/test";

const ALLOWED_CURVES = ["cubic-bezier(0.2, 0, 0, 1)", "cubic-bezier(0.4, 0, 1, 1)"];
const ALLOWED_ANIMATIONS = ["toast-in", "skeleton", "reveal", "settle", "spin"];
/** Properties whose change forces layout; animating them is slow on ordinary hardware. */
const LAYOUT_PROPERTIES =
  /^(all|width|height|min-|max-|margin|padding|top|right|bottom|left|inset)/;

/** Everything that moves on the page, elements and their ::before / ::after included. */
const motionOf = (page: Page) =>
  page.evaluate(() => {
    // Split a computed list on its top-level commas only: cubic-bezier(…) has commas inside.
    const list = (value: string) => value.split(/,(?![^(]*\))/).map((part) => part.trim());
    const ms = (value: string) => (Number.parseFloat(value) || 0) * 1000;
    const result = {
      longestTransition: 0,
      longestAnimation: 0,
      properties: new Set<string>(),
      curves: new Set<string>(),
      animations: new Set<string>(),
    };
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        const durations = list(style.transitionDuration).map(ms);
        const properties = list(style.transitionProperty);
        const curves = list(style.transitionTimingFunction);
        durations.forEach((duration, index) => {
          if (duration <= 0) return;
          result.longestTransition = Math.max(result.longestTransition, duration);
          result.properties.add(properties[index % properties.length] ?? "");
          result.curves.add(curves[index % curves.length] ?? "");
        });
        for (const name of list(style.animationName)) {
          if (name !== "none") result.animations.add(name);
        }
        for (const duration of list(style.animationDuration).map(ms)) {
          result.longestAnimation = Math.max(result.longestAnimation, duration);
        }
      }
    }
    return {
      longestTransition: result.longestTransition,
      longestAnimation: result.longestAnimation,
      properties: [...result.properties],
      curves: [...result.curves],
      animations: [...result.animations],
    };
  });

for (const path of ["/", "/login", "/signup"]) {
  test(`${path}: motion follows the system, and reduced motion makes it instant`, async ({
    page,
  }) => {
    await page.goto(path);
    const normal = await motionOf(page);
    // Nothing in the system is slower than the 250 ms drawer.
    expect(normal.longestTransition).toBeGreaterThan(0);
    expect(normal.longestTransition).toBeLessThanOrEqual(250);
    expect(normal.properties.filter((property) => LAYOUT_PROPERTIES.test(property))).toEqual([]);
    expect(normal.curves.filter((curve) => !ALLOWED_CURVES.includes(curve))).toEqual([]);
    expect(normal.animations.filter((name) => !ALLOWED_ANIMATIONS.includes(name))).toEqual([]);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const reduced = await motionOf(page);
    expect(reduced.longestTransition).toBeLessThanOrEqual(0.01);
    expect(reduced.longestAnimation).toBeLessThanOrEqual(0.01);
    // Content never waits on an animation: the main heading is there at once.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 1000 });
  });
}
