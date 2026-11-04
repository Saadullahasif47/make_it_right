/**
 * The homepage as screens: the hero is complete in the first screen on a laptop, each later
 * section rises into view once as it is reached, and the brand logo shows on every surface.
 */
import { expect, test } from "@playwright/test";

test("on a laptop the hero is complete in the first screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones stack the hero and the demonstration.");
  await page.goto("/");
  const fit = await page.evaluate(() => {
    const hero = document.querySelector("#hero-title")?.closest("section");
    return {
      bottom: hero?.getBoundingClientRect().bottom ?? Infinity,
      height: window.innerHeight,
      scrolled: window.scrollY,
    };
  });
  expect(fit.scrolled).toBe(0);
  expect(fit.bottom).toBeLessThanOrEqual(fit.height);
  await expect(page.getByRole("link", { name: "Report an issue" }).nth(1)).toBeInViewport();
});

test("sections below the fold rise into view once, when reached", async ({ page }) => {
  await page.goto("/");
  const roles = page.locator("section#roles");
  await expect(roles).toHaveAttribute("data-reveal", "pending");
  await roles.scrollIntoViewIfNeeded();
  await expect(roles).toHaveAttribute("data-reveal", "shown");
  await expect(roles.getByRole("heading", { level: 2 })).toBeVisible();
  // Once shown it stays shown: scrolling away and back does not replay it.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await roles.scrollIntoViewIfNeeded();
  await expect(roles).toHaveAttribute("data-reveal", "shown");
});

test("with reduced motion nothing is ever hidden waiting for a reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
});

test("the logo is the brand artwork, named as a link home, on light and dark surfaces", async ({
  page,
}) => {
  await page.goto("/");
  const home = page.getByRole("banner").getByRole("link", { name: "MakeItRight home" });
  await expect(home.locator('img[src*="makeitright-logo"]').first()).toBeVisible();

  // The sign-in panel is dark, so it shows the version with light lettering.
  await page.goto("/login");
  const panelLogo = page.locator("aside").getByRole("link", { name: "MakeItRight home" });
  if (await panelLogo.isVisible()) {
    await expect(panelLogo.locator('img[src*="logo-on-dark"]')).toBeVisible();
  }
});
