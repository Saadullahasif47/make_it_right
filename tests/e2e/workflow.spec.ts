/**
 * Department workflow journeys across roles (master plan P3.04-P3.10; Gate P3: full complaint
 * resolution works without any AI provider, with correct permissions and history).
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, signIn } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const cleanup: string[] = [];
let student: TestUser;
let electrician: TestUser;
let plumber: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, electrician, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  cleanup.push(student.id, electrician.id, plumber.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

async function signedIn(browser: Browser, user: TestUser, home: RegExp): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return page;
}

async function createTicket(title: string): Promise<string> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: title,
      p_description: "Created for the department workflow journey tests.",
      p_building: "Block E",
      p_room: "12",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return data.id;
}

async function assignToElectrical(ticketId: string): Promise<void> {
  const { error } = await admin.client
    .rpc("assign_ticket", {
      p_ticket_id: ticketId,
      p_department_id: await departmentId("electrical"),
      p_category: "electrical",
      p_priority: "high",
      p_expected_version: 1,
    })
    .single();
  if (error !== null) throw new Error(error.message);
}

const panel = (page: Page) =>
  page.getByRole("region", { name: /Update this ticket|Is it fixed\?/ });
const history = (page: Page) => page.getByRole("list", { name: "Ticket history" });

test("Gate P3: a ticket goes from report to closed through the UI, by three roles, without AI", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const title = `Lifecycle ${randomUUID().slice(0, 8)}`;

  // 1. The student reports the problem.
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  await studentPage.goto("/student/complaints/new");
  await studentPage.getByLabel("What is wrong?").fill(title);
  await studentPage.getByLabel("Building").fill("Block E");
  await studentPage
    .getByLabel("Describe the problem")
    .fill("The corridor lights flicker and buzz all evening.");
  await studentPage.getByRole("button", { name: "Submit report" }).click();
  await expect(studentPage).toHaveURL(/notice=created$/);
  const ticketId = new URL(studentPage.url()).pathname.split("/").at(-1) ?? "";
  await expect(panel(studentPage)).toHaveCount(0); // nothing for the reporter to do yet

  // 2. The admin finds it in the review queue and routes it.
  const adminPage = await signedIn(browser, admin, /\/admin$/);
  await adminPage.getByRole("link", { name: "Open review queue" }).click();
  await adminPage.getByRole("link", { name: new RegExp(title) }).click();
  await expect(adminPage).toHaveURL(new RegExp(`/admin/complaints/${ticketId}$`));
  const routing = adminPage.getByRole("region", { name: "Route this ticket" });
  await routing.getByLabel("Category").selectOption("electrical");
  await expect(routing.getByLabel("Department")).toHaveValue(await departmentId("electrical"));
  await routing.getByLabel("Priority").selectOption("high");
  await routing.getByRole("button", { name: "Assign ticket" }).click();
  await expect(adminPage).toHaveURL(/notice=assigned$/);
  await expect(history(adminPage).getByText("Assigned to Electrical Maintenance")).toBeVisible();
  await expect(history(adminPage).getByText("Electrical · High priority")).toBeVisible();

  // 3. The electrician sees it as new in the queue, acknowledges, works and resolves it.
  const staffPage = await signedIn(browser, electrician, /\/department$/);
  const queueItem = staffPage
    .getByRole("list", { name: "Complaints" })
    .getByRole("listitem")
    .filter({ hasText: title });
  await expect(queueItem.getByText("New", { exact: true })).toBeVisible();
  await expect(queueItem.getByText("High priority")).toBeVisible();
  await queueItem.getByRole("link").click();
  await panel(staffPage).getByRole("button", { name: "Acknowledge" }).click();
  await expect(staffPage).toHaveURL(/notice=acknowledged$/);
  await panel(staffPage).getByRole("button", { name: "Start work" }).click();
  await expect(staffPage).toHaveURL(/notice=in_progress$/);

  const notePanel = panel(staffPage);
  await notePanel.getByLabel("Work note").fill("Replaced the faulty starter.");
  await notePanel.getByRole("button", { name: "Add note" }).click();
  await expect(staffPage).toHaveURL(/notice=note$/);

  await panel(staffPage).getByRole("button", { name: "Mark resolved" }).click();
  await expect(panel(staffPage).getByText("Describe what was done to fix it")).toBeVisible();
  await panel(staffPage)
    .getByLabel("What was done?")
    .fill("Starter and tube replaced, tested for 30 minutes.");
  await panel(staffPage).getByRole("button", { name: "Mark resolved" }).click();
  await expect(staffPage).toHaveURL(/notice=resolved$/);
  // Resolved: no status change is left for the department; work notes stay available.
  await expect(panel(staffPage).getByRole("button", { name: "Start work" })).toHaveCount(0);
  await expect(panel(staffPage).getByRole("button", { name: "Mark resolved" })).toHaveCount(0);
  await expect(panel(staffPage).getByRole("button", { name: "Add note" })).toBeVisible();

  // 4. The student disputes once, the department fixes again, then the student closes.
  await studentPage.goto(`/student/complaints/${ticketId}`);
  const decision = studentPage.getByRole("region", { name: "Is it fixed?" });
  await decision.getByLabel("What is still wrong?").fill("Still buzzing near the stairs.");
  await decision.getByRole("button", { name: "No, it is still a problem" }).click();
  await expect(studentPage).toHaveURL(/notice=reopened$/);

  await staffPage.goto(`/department/${ticketId}`);
  await panel(staffPage).getByRole("button", { name: "Start work" }).click();
  await panel(staffPage).getByLabel("What was done?").fill("Second tube near the stairs replaced.");
  await panel(staffPage).getByRole("button", { name: "Mark resolved" }).click();
  await expect(staffPage).toHaveURL(/notice=resolved$/);

  await studentPage.goto(`/student/complaints/${ticketId}`);
  await studentPage
    .getByRole("region", { name: "Is it fixed?" })
    .getByRole("button", { name: "Yes, it is fixed" })
    .click();
  await expect(studentPage).toHaveURL(/notice=closed$/);
  await expect(studentPage.getByRole("main").locator("header").getByText("Closed")).toBeVisible();

  // 5. The whole history is on the timeline, in order, attributed by role.
  const titles = await history(studentPage).locator("li > div > p:first-child").allTextContents();
  expect(titles).toEqual([
    "Report submitted",
    "Assigned to Electrical Maintenance",
    "Acknowledged by the department",
    "Work started",
    "Work note",
    "Marked resolved",
    "Reopened: still a problem",
    "Work started",
    "Marked resolved",
    "Closed: fix confirmed",
  ]);
  await expect(history(studentPage).getByText("Replaced the faulty starter.")).toBeVisible();
  await expect(history(studentPage).getByText(/^Administrator ·/)).toBeVisible();

  const { data } = await adminClient()
    .from("complaints")
    .select("status, version")
    .eq("id", ticketId)
    .single();
  expect(data).toEqual({ status: "closed", version: 9 });
});

test("two staff with the same ticket open: the second change is refused, not lost (P3.08)", async ({
  browser,
}) => {
  const ticketId = await createTicket("Conflict ticket");
  await assignToElectrical(ticketId);

  const tabA = await signedIn(browser, electrician, /\/department$/);
  const tabB = await tabA.context().newPage();
  await tabA.goto(`/department/${ticketId}`);
  await tabB.goto(`/department/${ticketId}`);

  await panel(tabA).getByRole("button", { name: "Start work" }).click();
  await expect(tabA).toHaveURL(/notice=in_progress$/);

  // Tab B still shows the old version; its click must be refused.
  await panel(tabB).getByRole("button", { name: "Acknowledge" }).click();
  const alert = panel(tabB).getByRole("alert");
  await expect(alert).toContainText("This ticket changed while you were looking at it");
  await alert.getByRole("link", { name: "Refresh" }).click();
  await expect(tabB.getByRole("main").locator("header").getByText("In progress")).toBeVisible();

  const { data } = await adminClient()
    .from("ticket_events")
    .select("event_type")
    .eq("complaint_id", ticketId)
    .order("id");
  expect(data?.map((event) => event.event_type)).toEqual(["created", "assigned", "status_changed"]);
});

test("departments see only their own tickets, and roles see only their own controls", async ({
  browser,
}) => {
  const ticketId = await createTicket("Isolation ticket");
  await assignToElectrical(ticketId);

  const plumbing = await signedIn(browser, plumber, /\/department$/);
  await expect(plumbing.getByText("Isolation ticket")).toHaveCount(0);
  await plumbing.goto(`/department/${ticketId}`);
  await expect(plumbing.getByRole("heading", { name: "This page does not exist" })).toBeVisible();

  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  await studentPage.goto(`/student/complaints/${ticketId}`);
  await expect(studentPage.getByRole("heading", { level: 1 })).toHaveText("Isolation ticket");
  await expect(studentPage.getByRole("button", { name: "Start work" })).toHaveCount(0);
  await expect(studentPage.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await studentPage.goto(`/admin/complaints/${ticketId}`);
  await expect(
    studentPage.getByRole("heading", { name: "You do not have access to this page" }),
  ).toBeVisible();

  const statusApi = await studentPage.request.patch(`/api/complaints/${ticketId}/status`, {
    data: { target: "in_progress", expectedVersion: 2 },
  });
  expect(statusApi.status()).toBe(403);
  const reviewApi = await studentPage.request.post(`/api/complaints/${ticketId}/review`, {
    data: {
      departmentId: await departmentId("plumbing"),
      category: "plumbing",
      priority: "low",
      expectedVersion: 2,
    },
  });
  expect(reviewApi.status()).toBe(403);
});

test("the workflow API follows the plan's contract (plan §11)", async ({ browser }) => {
  const ticketId = await createTicket("API contract ticket");
  const adminPage = await signedIn(browser, admin, /\/admin$/);

  const review = await adminPage.request.post(`/api/complaints/${ticketId}/review`, {
    data: {
      departmentId: await departmentId("electrical"),
      category: "electrical",
      priority: "medium",
      expectedVersion: 1,
    },
  });
  expect(review.status()).toBe(200);
  expect(await review.json()).toMatchObject({ status: "assigned", version: 2 });

  const stale = await adminPage.request.patch(`/api/complaints/${ticketId}/status`, {
    data: { target: "in_progress", expectedVersion: 1 },
  });
  expect(stale.status()).toBe(409);
  expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("STALE_VERSION");

  const illegal = await adminPage.request.patch(`/api/complaints/${ticketId}/status`, {
    data: { target: "closed", expectedVersion: 2 },
  });
  expect(illegal.status()).toBe(409);
  expect(((await illegal.json()) as { error: { code: string } }).error.code).toBe(
    "INVALID_TRANSITION",
  );

  const started = await adminPage.request.patch(`/api/complaints/${ticketId}/status`, {
    data: { target: "in_progress", expectedVersion: 2 },
  });
  expect(started.status()).toBe(200);
  expect(await started.json()).toMatchObject({ status: "in_progress", version: 3 });
});

test("department and admin workflow pages have no WCAG 2.1 AA violations", async ({ browser }) => {
  const ticketId = await createTicket("Accessibility workflow ticket");
  await assignToElectrical(ticketId);

  const scan = async (page: Page, title: RegExp) => {
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  };

  const staffPage = await signedIn(browser, electrician, /\/department$/);
  await staffPage.emulateMedia({ reducedMotion: "reduce" });
  await scan(staffPage, /^Department queue · MakeItRight$/);
  await staffPage.goto(`/department/${ticketId}`);
  await scan(staffPage, /^Ticket · MakeItRight$/);

  const adminPage = await signedIn(browser, admin, /\/admin$/);
  await adminPage.emulateMedia({ reducedMotion: "reduce" });
  await scan(adminPage, /^Admin overview · MakeItRight$/);
  await adminPage.goto("/admin/review");
  await scan(adminPage, /^Review queue · MakeItRight$/);
  await adminPage.goto(`/admin/complaints/${ticketId}`);
  await scan(adminPage, /^Ticket · MakeItRight$/);
});
