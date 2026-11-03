/**
 * AI triage journeys (master plan P4.07-P4.11; Gate P4). These run against the second server
 * started by playwright.config.ts, with AI switched on and the real Gemini adapter talking to
 * the local stub (tests/support/gemini-stub.mts). Markers in a report script the stub.
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { AI_PORT } from "../../playwright.config";
import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, signIn } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const AI_URL = `http://localhost:${AI_PORT}`;
test.use({ baseURL: AI_URL });

const cleanup: string[] = [];
let student: TestUser;
let electrician: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, electrician, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
  cleanup.push(student.id, electrician.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

async function signedIn(browser: Browser, user: TestUser, home: RegExp): Promise<Page> {
  const context = await browser.newContext({ baseURL: AI_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return page;
}

/** Submits through the real form and returns the new ticket's id. */
async function report(page: Page, title: string, description: string): Promise<string> {
  await page.goto("/student/complaints/new");
  await page.getByLabel("What is wrong?").fill(title);
  await page.getByLabel("Building").fill("Block C");
  await page.getByLabel("Describe the problem").fill(description);
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(/\/student\/complaints\/[0-9a-f-]{36}\?notice=/, {
    timeout: 20_000,
  });
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

async function runsOf(ticketId: string) {
  const { data } = await adminClient()
    .from("agent_runs")
    .select("outcome, failure_code, tool_calls")
    .eq("complaint_id", ticketId)
    .order("started_at");
  return data ?? [];
}

const history = (page: Page) => page.getByRole("list", { name: "Ticket history" });
const aiPanel = (page: Page) => page.getByRole("region", { name: "AI routing" });

test("Gate P4: a normal complaint is routed by the agent to its approved department", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const title = `Lights out ${randomUUID().slice(0, 8)}`;
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);

  const ticketId = await report(
    studentPage,
    title,
    "All ceiling lights in the second floor corridor are off.",
  );

  await expect(studentPage).toHaveURL(/notice=created-routed$/);
  await expect(studentPage.getByText("sent to the department that handles it")).toBeVisible();
  await expect(history(studentPage).getByText("AI routing started")).toBeVisible();
  await expect(history(studentPage).getByText("Assigned to Electrical Maintenance")).toBeVisible();
  await expect(
    history(studentPage)
      .getByText(/AI assistant ·/)
      .first(),
  ).toBeVisible();
  await expect(
    history(studentPage).getByText("The report describes a electrical fault."),
  ).toBeVisible();

  // It is in the electrical queue, marked new, like a manually routed ticket.
  const staffPage = await signedIn(browser, electrician, /\/department$/);
  const item = staffPage
    .getByRole("list", { name: "Complaints" })
    .getByRole("listitem")
    .filter({ hasText: title });
  await expect(item.getByText("New", { exact: true })).toBeVisible();

  const { data } = await adminClient()
    .from("complaints")
    .select("assigned_department_id, priority")
    .eq("id", ticketId)
    .single();
  expect(data).toEqual({
    assigned_department_id: await departmentId("electrical"),
    priority: "medium",
  });
});

test("P4.11: the admin sees a rejected tool call and the accepted one that followed", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const ticketId = await report(
    studentPage,
    `Socket dead ${randomUUID().slice(0, 8)}`,
    "The wall power socket by desk 4 does not work. STUB:WRONG-FIRST",
  );
  await expect(studentPage).toHaveURL(/notice=created-routed$/);

  const adminPage = await signedIn(browser, admin, /\/admin$/);
  await adminPage.goto(`/admin/complaints/${ticketId}`);
  const panel = aiPanel(adminPage);
  await expect(panel.getByText("Routed automatically")).toBeVisible();
  const calls = panel.getByRole("list", { name: "Tool calls" }).getByRole("listitem");
  await expect(calls).toHaveCount(3);
  await expect(calls.nth(0)).toContainText("propose_assignment rejected");
  await expect(calls.nth(0)).toContainText("DEPARTMENT_NOT_APPROVED");
  await expect(calls.nth(0)).toContainText("unknown department id");
  await expect(calls.nth(1)).toContainText("find_category_route answered");
  await expect(calls.nth(2)).toContainText("propose_assignment accepted");
  await expect(calls.nth(2)).toContainText("Electrical Maintenance");
  await panel.screenshot({ path: "test-results/evidence/p4-tool-calls.png" });

  expect((await runsOf(ticketId))[0]?.tool_calls).toEqual([
    expect.objectContaining({ verdict: "rejected", code: "DEPARTMENT_NOT_APPROVED" }),
    expect.objectContaining({ verdict: "ok" }),
    expect.objectContaining({ verdict: "accepted" }),
  ]);
});

test("provider failure: the ticket is saved, explained to the reporter, and recoverable by retry", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const title = `Projector ${randomUUID().slice(0, 8)}`;
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const ticketId = await report(
    studentPage,
    title,
    "The projector in room 101 shows no picture. STUB:FAIL-ONCE",
  );

  await expect(studentPage).toHaveURL(/notice=created$/);
  await expect(studentPage.getByText("Awaiting review").first()).toBeVisible();
  await expect(history(studentPage).getByText("Sent to an administrator")).toBeVisible();
  await expect(history(studentPage).getByText("could not be routed automatically")).toBeVisible();
  // The reporter never sees provider or failure details.
  await expect(studentPage.getByText(/RATE_LIMITED|rate limit|Gemini/i)).toHaveCount(0);

  const adminPage = await signedIn(browser, admin, /\/admin$/);
  await adminPage.goto("/admin/review");
  await adminPage.getByRole("link", { name: new RegExp(title) }).click();
  const panel = aiPanel(adminPage);
  await expect(panel.getByText("Sent for review")).toBeVisible();
  await expect(panel.getByText("The AI provider's rate limit was reached")).toBeVisible();

  await panel.getByRole("button", { name: "Retry AI routing" }).click();
  await expect(adminPage).toHaveURL(/notice=ai-routed$/, { timeout: 20_000 });
  await expect(aiPanel(adminPage).getByText("Routed automatically")).toBeVisible();
  await expect(aiPanel(adminPage).getByText("Admin retry")).toBeVisible();
  await expect(history(adminPage).getByText("Assigned to IT Services")).toBeVisible();

  expect(
    (await runsOf(ticketId)).map((run) => `${run.outcome}:${run.failure_code ?? "-"}`),
  ).toEqual(["needs_review:RATE_LIMITED", "routed:-"]);
});

test("a slow provider hits the deadline; the ticket is saved and waits for review", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const started = Date.now();
  const ticketId = await report(
    studentPage,
    `Fan ${randomUUID().slice(0, 8)}`,
    "The ceiling fan in room 12 makes a grinding noise. STUB:SLOW",
  );

  expect(Date.now() - started).toBeLessThan(15_000);
  await expect(studentPage.getByText("Awaiting review").first()).toBeVisible();
  expect((await runsOf(ticketId))[0]).toMatchObject({
    outcome: "needs_review",
    failure_code: "TIMEOUT",
  });
});

test("a dangerous report is never routed automatically; the admin form starts from the suggestion", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const ticketId = await report(
    studentPage,
    `Sparking socket ${randomUUID().slice(0, 8)}`,
    "The socket near the lab door is sparking and smells of burning.",
  );
  await expect(studentPage.getByText("Awaiting review").first()).toBeVisible();

  const adminPage = await signedIn(browser, admin, /\/admin$/);
  await adminPage.goto(`/admin/complaints/${ticketId}`);
  await expect(
    aiPanel(adminPage).getByText("The report mentions a possible safety risk"),
  ).toBeVisible();
  const routing = adminPage.getByRole("region", { name: "Route this ticket" });
  await expect(routing.getByLabel("Category")).toHaveValue("electrical");
  await expect(routing.getByLabel("Department")).toHaveValue(await departmentId("electrical"));
  await expect(routing.getByText("starts from the AI assistant's suggestion")).toBeVisible();
});

test("a model that keeps inventing a department changes nothing", async ({ browser }) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const ticketId = await report(
    studentPage,
    `Desk ${randomUUID().slice(0, 8)}`,
    "The desk drawer is jammed. STUB:FABRICATE",
  );

  await expect(studentPage.getByText("Awaiting review").first()).toBeVisible();
  const { data } = await adminClient()
    .from("complaints")
    .select("status, category, assigned_department_id")
    .eq("id", ticketId)
    .single();
  expect(data).toEqual({
    status: "needs_review",
    category: "unclassified",
    assigned_department_id: null,
  });
  expect((await runsOf(ticketId))[0]).toMatchObject({ failure_code: "STEP_LIMIT" });
});

test("API: create returns the routed status; retry-ai is admin-only, bounded and strict", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const created = await studentPage.request.post("/api/complaints", {
    headers: { "idempotency-key": randomUUID(), origin: AI_URL },
    data: {
      title: "Tap dripping",
      description: "The tap in the 2F washroom drips constantly.",
      building: "Block C",
      room: "2F",
    },
  });
  expect(created.status()).toBe(201);
  const ticket = (await created.json()) as { id: string; status: string };
  expect(ticket.status).toBe("assigned");

  const retryUrl = `/api/complaints/${ticket.id}/retry-ai`;
  const asStudent = await studentPage.request.post(retryUrl, {
    headers: { origin: AI_URL },
    data: {},
  });
  expect(asStudent.status()).toBe(403);

  const adminPage = await signedIn(browser, admin, /\/admin$/);
  const smuggled = await adminPage.request.post(retryUrl, {
    headers: { origin: AI_URL },
    data: { departmentId: "x" },
  });
  expect(smuggled.status()).toBe(400);
  const routed = await adminPage.request.post(retryUrl, { headers: { origin: AI_URL }, data: {} });
  expect(routed.status()).toBe(409);
  expect(((await routed.json()) as { error: { code: string } }).error.code).toBe(
    "INVALID_TRANSITION",
  );
  const crossSite = await adminPage.request.post(retryUrl, {
    headers: { origin: "https://evil.example" },
    data: {},
  });
  expect(crossSite.status()).toBe(403);
});

test("the admin ticket page with AI history has no WCAG 2.1 AA violations", async ({ browser }) => {
  test.setTimeout(90_000);
  const studentPage = await signedIn(browser, student, /\/student\/complaints$/);
  const ticketId = await report(
    studentPage,
    `Bins ${randomUUID().slice(0, 8)}`,
    "The bins outside Block C are overflowing. STUB:429",
  );
  const adminPage = await signedIn(browser, admin, /\/admin$/);

  // Scanned with animations settled, as the other specs do: fade-ins are not content.
  const pages: readonly (readonly [Page, string, RegExp])[] = [
    [adminPage, `/admin/complaints/${ticketId}`, /^Ticket · MakeItRight$/],
    [adminPage, "/admin/review", /^Review queue · MakeItRight$/],
    [studentPage, `/student/complaints/${ticketId}`, /^Complaint · MakeItRight$/],
  ];
  for (const [page, path, title] of pages) {
    await page.emulateMedia({ reducedMotion: "reduce" });
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
