/**
 * Administrator operations (master plan P5.01, P5.06, P5.08; Gate P5: admin sees accurate
 * aggregates and bad requests visibly fail). Global numbers move while other specs run in
 * parallel, so exact counts are asserted on a department created for this test only.
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, signIn } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const cleanup: string[] = [];
const departments: string[] = [];
let student: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, admin] = await Promise.all([createTestUser("student"), createTestUser("admin")]);
  cleanup.push(student.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
  if (departments.length > 0) {
    await adminClient().from("departments").delete().in("id", departments);
  }
});

async function signedIn(browser: Browser, user: TestUser, home: RegExp): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return page;
}

async function testDepartment(label: string): Promise<{ id: string; name: string; code: string }> {
  const suffix = randomUUID().slice(0, 8);
  const name = `${label} ${suffix}`;
  const code = `e2e_${suffix}`;
  const { data, error } = await adminClient()
    .from("departments")
    .insert({ code, name })
    .select("id")
    .single();
  if (error !== null) throw new Error(error.message);
  departments.push(data.id);
  return { id: data.id, name, code };
}

async function ticketAssignedTo(departmentId: string, acknowledged: boolean): Promise<void> {
  const { data: created, error } = await student.client
    .rpc("create_ticket", {
      p_title: `Ops ticket ${randomUUID().slice(0, 6)}`,
      p_description: "A fictional report used by the admin dashboard tests.",
      p_building: "Block O",
      p_room: "1",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  const assigned = await admin.client
    .rpc("assign_ticket", {
      p_ticket_id: created.id,
      p_department_id: departmentId,
      p_category: "other",
      p_priority: "medium",
      p_expected_version: 1,
    })
    .single();
  if (assigned.error !== null) throw new Error(assigned.error.message);
  if (acknowledged) {
    // Acknowledgement is department work; set it directly for this fixture only.
    await adminClient()
      .from("complaints")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", created.id);
  }
}

test("the dashboard shows exact workload for a department and switches reporting periods", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const department = await testDepartment("E2E Workload");
  await ticketAssignedTo(department.id, false);
  await ticketAssignedTo(department.id, true);

  const page = await signedIn(browser, admin, /\/admin$/);
  for (const heading of [
    "Tickets by status",
    "Age of open tickets",
    "New reports per day",
    "Department workload",
    "AI routing",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const row = page.getByRole("row").filter({ hasText: department.name });
  await expect(row.getByRole("cell")).toHaveText([department.name, "2", "1", "0", "0"]);

  await page.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/\/admin\?window=7$/);
  await expect(page.getByRole("link", { name: "Last 7 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Resolved (7 days)")).toBeVisible();

  // An unsupported period falls back to the default instead of failing.
  await page.goto("/admin?window=13");
  await expect(page.getByRole("link", { name: "Last 30 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("an admin can take a department offline and back; every change is logged", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const department = await testDepartment("E2E Toggle");
  const page = await signedIn(browser, admin, /\/admin$/);
  await page.goto("/admin/departments");

  const item = page
    .getByRole("table", { name: "Departments" })
    .getByRole("row")
    .filter({ hasText: department.name });
  await expect(item.getByText("Active", { exact: true })).toBeVisible();
  await item.getByRole("button", { name: `Deactivate ${department.name}` }).click();
  await expect(page).toHaveURL(/notice=department-deactivated$/);
  await expect(page.getByText("no longer receives new tickets")).toBeVisible();
  await expect(item.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent configuration changes" })).toContainText(
    `Deactivated ${department.name}`,
  );

  await item.getByRole("button", { name: `Activate ${department.name}` }).click();
  await expect(page).toHaveURL(/notice=department-activated$/);
  const { data } = await adminClient()
    .from("departments")
    .select("is_active")
    .eq("id", department.id)
    .single();
  expect(data?.is_active).toBe(true);
});

test("routing rules: save, no-op and a refused change are all visible", async ({
  browser,
}, testInfo) => {
  // This changes the shared rule for "Other"; one project runs it so runs never overlap.
  test.skip(testInfo.project.name !== "desktop-chromium", "mutates shared routing configuration");
  test.setTimeout(90_000);
  const target = await testDepartment("E2E Routing");
  const inactive = await testDepartment("E2E Offline");
  await adminClient().from("departments").update({ is_active: false }).eq("id", inactive.id);
  const { data: original } = await adminClient()
    .from("routing_rules")
    .select("department_id, enabled")
    .eq("category", "other")
    .single();

  try {
    const page = await signedIn(browser, admin, /\/admin$/);
    await page.goto("/admin/departments");
    const department = page.getByLabel("Department for Other");
    await department.selectOption(target.id);
    await page.getByRole("button", { name: "Save routing for Other" }).click();
    await expect(page).toHaveURL(/notice=routing-saved$/);
    const { data: saved } = await adminClient()
      .from("routing_rules")
      .select("department_id")
      .eq("category", "other")
      .single();
    expect(saved?.department_id).toBe(target.id);

    await page.getByRole("button", { name: "Save routing for Other" }).click();
    await expect(page).toHaveURL(/notice=no-change$/);
    await expect(page.getByText("Nothing changed")).toBeVisible();

    await page.getByLabel("Department for Other").selectOption(inactive.id);
    await page.getByRole("button", { name: "Save routing for Other" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "An enabled rule needs an active department",
    );
    const { data: unchanged } = await adminClient()
      .from("routing_rules")
      .select("department_id")
      .eq("category", "other")
      .single();
    expect(unchanged?.department_id).toBe(target.id);
  } finally {
    if (original !== null) {
      await adminClient().from("routing_rules").update(original).eq("category", "other");
    }
  }
});

test("non-admins cannot open the admin pages or the metrics API", async ({ browser }) => {
  const page = await signedIn(browser, student, /\/student\/complaints$/);
  for (const path of ["/admin", "/admin/departments"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "You do not have access to this page" }),
    ).toBeVisible();
  }
  const response = await page.request.get("/api/admin/metrics");
  expect(response.status()).toBe(403);
  const anonymous = await (await browser.newContext()).request.get("/api/admin/metrics");
  expect(anonymous.status()).toBe(401);
});

test("the dashboard and departments page have no WCAG 2.1 AA violations", async ({ browser }) => {
  const page = await signedIn(browser, admin, /\/admin$/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [path, title] of [
    ["/admin", /^Admin overview · MakeItRight$/],
    ["/admin/departments", /^Departments · MakeItRight$/],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`),
      path,
    ).toEqual([]);
  }
});
