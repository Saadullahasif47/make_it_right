/**
 * Light first: the designed light interface whatever the operating system prefers, with the dark
 * theme as a person's own choice, remembered on the device and applied before the first paint.
 */
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteUsers, type TestUser } from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, signIn } from "./support/local-stack";

const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT_CANVAS = "rgb(248, 250, 249)"; // #f8faf9

test("a laptop set to dark mode still gets the light design", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/login"]) {
    await page.goto(path);
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  }
});

test.describe("the opt-in dark theme", () => {
  test.skip(!hasLocalStack(), LOCAL_STACK_REASON);
  let student: TestUser;
  test.beforeAll(async () => {
    student = await createTestUser("student");
  });
  test.afterAll(async () => {
    await deleteUsers([student.id]);
  });

  test("is chosen in the account area, survives a reload, and can be switched back", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await canvas(page)).not.toBe(LIGHT_CANVAS);

    // Applied before the first paint on the next load: no light flash, no hydration warning.
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") warnings.push(message.text());
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(warnings.filter((text) => /hydrat/i.test(text))).toEqual([]);

    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    await page.reload();
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
  });
});
