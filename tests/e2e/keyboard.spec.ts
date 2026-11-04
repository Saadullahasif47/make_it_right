/**
 * Keyboard-only walkthrough (UI redesign Stage 5 gate): each role's main job done with Tab,
 * Shift+Tab, Enter and typing alone, with a visible focus ring on every stop it uses.
 */
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);
test.skip(({ isMobile }) => isMobile, "A keyboard walkthrough is a desktop concern.");

const cleanup: string[] = [];
test.afterAll(async () => {
  await deleteUsers(cleanup);
});

async function user(role: "student" | "department" | "admin"): Promise<TestUser> {
  const created = await createTestUser(role, role === "department" ? "electrical" : undefined);
  cleanup.push(created.id);
  return created;
}

/** The focused element's accessible-ish name: its label, aria-label or text. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null) return "";
    // Form fields are named by their label; everything else by aria-label or its text.
    const label = (element as HTMLInputElement).labels?.[0];
    // innerText skips visibility-hidden text, as assistive technology does (the idle or
    // pending layer of a submit button).
    return (label?.textContent ?? element.getAttribute("aria-label") ?? element.innerText).trim();
  });

/**
 * Presses Tab until the focused element's name matches, failing if it is never reached, and
 * checks that the stop shows focus: the app's :focus-visible outline, or, on form fields, the
 * brand ring drawn as a box shadow.
 */
async function tabTo(page: Page, name: RegExp, limit = 60): Promise<void> {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    if (name.test(await focusedName(page))) {
      const indicator = await page.evaluate(() => {
        const element = document.activeElement;
        if (element === null) return { outline: "none", shadow: "none" };
        const style = getComputedStyle(element);
        return { outline: style.outlineStyle, shadow: style.boxShadow };
      });
      expect(
        indicator.outline !== "none" || indicator.shadow !== "none",
        `visible focus on ${name.source}`,
      ).toBe(true);
      return;
    }
  }
  throw new Error(`Tab never reached ${name.source}`);
}

async function signInByKeyboard(page: Page, account: TestUser, home: RegExp): Promise<void> {
  await page.goto("/login");
  await tabTo(page, /^Email$/);
  await page.keyboard.type(account.email);
  await tabTo(page, /^Password$/);
  await page.keyboard.type(account.password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(home);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Loads a page afresh, as someone arriving at it does. After a client-side redirect the focus
 * starting point is wherever the previous page left it, which is not where a visitor starts.
 */
async function arriveAt(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("a student reports an issue with the keyboard alone", async ({ page }) => {
  const student = await user("student");
  const title = `Keyboard report ${randomUUID().slice(0, 8)}`;
  await signInByKeyboard(page, student, /\/student\/complaints$/);
  await arriveAt(page, "/student/complaints");

  // The first stop is the skip link, and it moves past the navigation.
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Skip to content");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  await tabTo(page, /^Report an issue$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/student\/complaints\/new$/);

  await tabTo(page, /^What is wrong\?$/);
  await page.keyboard.type(title);
  await tabTo(page, /^Describe the problem/);
  await page.keyboard.type("The light in the corridor flickers all evening and buzzes.");
  await tabTo(page, /^Building$/);
  await page.keyboard.type("Block K");
  await tabTo(page, /^Submit report$/);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/notice=created$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});

test("department staff acknowledge and start work from the panel with the keyboard", async ({
  page,
}) => {
  const [student, staff] = await Promise.all([user("student"), user("department")]);
  const title = `Keyboard queue ${randomUUID().slice(0, 8)}`;
  const { error } = await adminClient()
    .from("complaints")
    .insert({
      created_by: student.id,
      title,
      description: "Seeded for the keyboard-only walkthrough.",
      building: "Block K",
      status: "assigned",
      category: "electrical",
      priority: "medium",
      assigned_department_id: await departmentId("electrical"),
    });
  expect(error).toBeNull();

  await signInByKeyboard(page, staff, /\/department$/);
  await arriveAt(page, "/department");
  await tabTo(page, new RegExp(`^${title}$`));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/department\?ticket=/);

  await tabTo(page, /^Acknowledge$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/notice=acknowledged$/);
  await tabTo(page, /^Start work$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/notice=in_progress$/);
  await expect(page.getByRole("list", { name: "Ticket history" })).toContainText("Work started");
});

test("an admin routes a waiting ticket with the keyboard", async ({ page }) => {
  const [student, admin] = await Promise.all([user("student"), user("admin")]);
  const title = `Keyboard review ${randomUUID().slice(0, 8)}`;
  const { error } = await adminClient().from("complaints").insert({
    created_by: student.id,
    title,
    description: "Seeded for the keyboard-only walkthrough of the review queue.",
    building: "Block K",
    status: "needs_review",
  });
  expect(error).toBeNull();

  await signInByKeyboard(page, admin, /\/admin$/);
  await arriveAt(page, "/admin/review");
  await tabTo(page, new RegExp(`^${title}$`));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/complaints\//);

  // Typing on a focused select picks the matching option, as it does for any keyboard user.
  await tabTo(page, /^Category$/);
  await page.keyboard.type("Electrical");
  await tabTo(page, /^Priority$/);
  await page.keyboard.type("High");
  await tabTo(page, /^Assign ticket$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/notice=assigned$/);
  await expect(page.getByRole("list", { name: "Ticket history" })).toContainText(
    "Assigned to Electrical Maintenance",
  );
});
