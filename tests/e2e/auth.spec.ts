/**
 * Authentication and role-access journeys (master plan P1.05, P1.06, P1.09).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  createTestUser,
  deleteUsers,
  uniqueEmail,
  adminClient,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, latestEmailLink, signIn } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

let student: TestUser;
let staff: TestUser;
let admin: TestUser;
const cleanup: string[] = [];

test.beforeAll(async () => {
  [student, staff, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
  cleanup.push(student.id, staff.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

test.describe("protected areas when signed out", () => {
  for (const path of ["/student/complaints", "/department", "/admin", "/account/password"]) {
    test(`${path} redirects to sign in and remembers the page`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe(`/login?next=${encodeURIComponent(path)}`);
      expect(response.headers()["cache-control"]).toContain("no-store");
    });
  }
});

test.describe("each role signs in to its own area", () => {
  const cases = [
    { name: "student", home: /\/student\/complaints$/, nav: "My complaints", label: "Student" },
    { name: "staff", home: /\/department$/, nav: "Department queue", label: "Department staff" },
    { name: "admin", home: /\/admin$/, nav: "Overview", label: "Administrator" },
  ] as const;

  for (const role of cases) {
    test(`${role.name} lands on their dashboard with role-aware navigation`, async ({ page }) => {
      const user = { student, staff, admin }[role.name];
      await page.goto("/login");
      await signIn(page, user.email, user.password);

      await expect(page).toHaveURL(role.home);
      const workspace = page.getByRole("navigation", { name: "Workspace" });
      await expect(workspace.getByRole("link", { name: role.nav })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(workspace.getByRole("link")).toHaveCount(1);
      await expect(page.getByRole("banner").getByText(role.label, { exact: true })).toBeVisible();
    });
  }

  test("the department dashboard names the staff member's own department", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/department$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Electrical Maintenance" }),
    ).toBeVisible();
  });

  test("the admin overview shows live account counts", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Electrical Maintenance" })).toBeVisible();
  });
});

test.describe("wrong role", () => {
  test("a student is refused the admin and department areas", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);

    for (const path of ["/admin", "/department"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "You do not have access to this page" }),
      ).toBeVisible();
      await expect(page.getByText("Accounts")).toHaveCount(0);
    }

    await page.getByRole("link", { name: "Go to your dashboard" }).click();
    await expect(page).toHaveURL(/\/student\/complaints$/);
  });

  test("department staff are refused the admin area", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/department$/);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "You do not have access to this page" }),
    ).toBeVisible();
  });
});

test.describe("redirect after sign-in", () => {
  test("returns to the page that required sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
    await signIn(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("ignores a next page that belongs to another role", async ({ page }) => {
    await page.goto("/login?next=%2Fadmin");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);
  });

  test("never follows an off-site next URL", async ({ page }) => {
    await page.goto("/login?next=%2F%2Fevil.example%2Fsteal");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/student\/complaints$/);
  });

  test("an already signed-in user visiting /login goes to their dashboard", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/department$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/department$/);
  });
});

test.describe("sign-in form", () => {
  test("rejects a wrong password with a generic message and keeps the email", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, student.email, "definitely-wrong-1");

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Email or password is incorrect.",
    );
    await expect(page.getByLabel("Email")).toHaveValue(student.email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  });

  test("gives the same message for an account that does not exist", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, uniqueEmail("nobody"), "whatever-12345");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Email or password is incorrect.",
    );
  });

  test("shows accessible field errors for empty input", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();

    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
  });

  test("lets the user reveal the password they typed", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("secret-text-1");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });
});

test.describe("session cookies and sign-out", () => {
  test("session cookies are HttpOnly and SameSite=Lax", async ({ page, context }) => {
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);

    const authCookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
    expect(authCookies.length).toBeGreaterThan(0);
    for (const cookie of authCookies) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
  });

  test("signing out ends the session", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "You have been signed out.",
    );
    await page.goto("/student/complaints");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("a tampered session cookie is treated as signed out", async ({ page, context }) => {
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);

    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(
      cookies
        .filter((cookie) => cookie.name.startsWith("sb-"))
        .map((cookie) => ({
          ...cookie,
          value: `base64-${Buffer.from('{"access_token":"forged"}').toString("base64")}`,
        })),
    );

    await page.goto("/student/complaints");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("an expired session (cookies removed) is sent back to sign in", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await signIn(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/admin$/);
    await context.clearCookies();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  });
});

test.describe("sign-up and password recovery (emails via the local inbox)", () => {
  test("a new student signs up, confirms by email and lands on their dashboard", async ({
    page,
  }) => {
    const email = uniqueEmail("e2e-signup");
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Playwright Student");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("campus2026e2e");
    await page.getByRole("button", { name: "Create student account" }).click();

    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "we have sent a confirmation link",
    );

    const link = await latestEmailLink(email, /\/auth\/confirm\?token_hash=[\w-]+&type=email$/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/student\/complaints$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi Playwright");

    const { data } = await adminClient()
      .from("profiles")
      .select("id, role")
      .eq("display_name", "Playwright Student");
    for (const row of data ?? []) cleanup.push(row.id);
    expect(data?.every((row) => row.role === "student")).toBe(true);
  });

  test("signing up with an existing email reveals nothing", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Duplicate Probe");
    await page.getByLabel("Email").fill(student.email);
    await page.getByLabel("Password", { exact: true }).fill("campus2026dup");
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "If this address can be registered",
    );
  });

  test("a forgotten password can be reset by email", async ({ page }) => {
    const user = await createTestUser("student");
    cleanup.push(user.id);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText("If an account exists");

    const link = await latestEmailLink(
      user.email,
      /\/auth\/confirm\?token_hash=[\w-]+&type=recovery$/,
    );
    await page.goto(link);
    await expect(page).toHaveURL(/\/account\/password$/);

    await page.getByLabel("New password", { exact: true }).fill("renewed2026pass");
    await page.getByLabel("Confirm new password").fill("renewed2026pass");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/student\/complaints\?notice=password-updated$/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Your password has been updated.",
    );

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, user.email, user.password);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Email or password is incorrect.",
    );
    await signIn(page, user.email, "renewed2026pass");
    await expect(page).toHaveURL(/\/student\/complaints$/);
  });

  test("a reused or forged email link is rejected", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=forgedforgedforged&type=email");
    await expect(page).toHaveURL(/\/login\?notice=link-invalid$/);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("invalid or has expired");
  });
});

test.describe("accessibility of auth and dashboard pages", () => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    test(`${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test("the student dashboard has no WCAG 2.1 AA violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints$/);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
