/**
 * Complaint submission and tracking journeys (master plan P2.04-P2.08, P2.10; Gate P2).
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "../integration/support/supabase";

import { LOCAL_STACK_REASON, hasLocalStack, signIn } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const cleanup: string[] = [];

async function newStudent(): Promise<TestUser> {
  const user = await createTestUser("student");
  cleanup.push(user.id);
  return user;
}

async function signInAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/student\/complaints$/);
}

async function complaintCount(userId: string): Promise<number> {
  const { count } = await adminClient()
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);
  return count ?? 0;
}

async function fillReport(page: Page, title: string): Promise<void> {
  await page.getByLabel("What is wrong?").fill(title);
  await page.getByLabel("Building").fill("Block C");
  await page.getByLabel("Room (optional)").fill("214");
  await page
    .getByLabel("Describe the problem")
    .fill("The ceiling fan stopped spinning this morning and makes a clicking noise.");
}

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

test.describe("reporting an issue", () => {
  test("a student submits a report, sees its reference and timeline, and it survives a reload", async ({
    page,
  }) => {
    const student = await newStudent();
    await signInAs(page, student);

    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "Report an issue" })
      .click();
    await expect(page).toHaveURL(/\/student\/complaints\/new$/);
    await fillReport(page, "Ceiling fan not working");
    await page.getByRole("button", { name: "Submit report" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/student/complaints/${UUID.source}\\?notice=created$`),
    );
    const notice = page.getByRole("main").getByRole("status");
    await expect(notice).toContainText("Your report has been saved");
    await expect(notice).toContainText(/MIR-\d+/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ceiling fan not working");
    await expect(page.getByText("Block C, room 214")).toBeVisible();
    await expect(page.getByText("Awaiting classification")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Ticket history" }).getByText("Report submitted"),
    ).toBeVisible();

    const reference =
      (await page.getByRole("main").locator("header .font-mono").textContent()) ?? "";
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ceiling fan not working");

    await page.getByRole("link", { name: "My complaints" }).first().click();
    const list = page.getByRole("list", { name: "Complaints" });
    await expect(list.getByText(reference)).toBeVisible();
    await expect(list.getByText("Submitted")).toBeVisible();
    expect(await complaintCount(student.id)).toBe(1);
  });

  test("a repeated form submission (double click, retry or replayed POST) creates one ticket", async ({
    page,
  }) => {
    const student = await newStudent();
    await signInAs(page, student);
    await page.goto("/student/complaints/new");
    await fillReport(page, "Double submitted report");

    // Capture the browser's real form-action request so it can be sent again byte for byte,
    // exactly as a network retry or a double POST would reach the server.
    let captured: { url: string; headers: Record<string, string>; body: Buffer } | undefined;
    page.on("request", (request) => {
      const body = request.postDataBuffer();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] !== undefined &&
        body !== null
      ) {
        captured = { url: request.url(), headers: request.headers(), body };
      }
    });

    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/student/complaints/${UUID.source}\\?notice=created$`),
    );
    const firstTicketUrl = page.url().split("?")[0] ?? "";
    expect(captured).toBeDefined();
    if (captured === undefined) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await page.request.fetch(captured.url, {
        method: "POST",
        headers: captured.headers,
        data: captured.body,
        maxRedirects: 0,
      });
      expect(replay.status(), "replayed submission must not fail").toBeLessThan(500);
    }

    expect(await complaintCount(student.id)).toBe(1);
    await page.goto(firstTicketUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Double submitted report");
  });

  test("invalid input shows accessible field errors and saves nothing", async ({ page }) => {
    const student = await newStudent();
    await signInAs(page, student);
    await page.goto("/student/complaints/new");

    await page.getByLabel("What is wrong?").fill("Fan");
    await page.getByRole("button", { name: "Submit report" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Some details need fixing",
    );
    await expect(page.getByLabel("What is wrong?")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Title needs at least 5 characters.")).toBeVisible();
    await expect(page.getByText("Building needs at least 2 characters.")).toBeVisible();
    await expect(page.getByLabel("What is wrong?")).toHaveValue("Fan");
    expect(await complaintCount(student.id)).toBe(0);
  });

  test("the landing page CTA leads a signed-out visitor through sign-in to the form", async ({
    page,
  }) => {
    const student = await newStudent();
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("link", { name: /report an issue/i })
      .click();
    await expect(page).toHaveURL(/\/login\?next=%2Fstudent%2Fcomplaints%2Fnew$/);
    await signIn(page, student.email, student.password);
    await expect(page).toHaveURL(/\/student\/complaints\/new$/);
  });
});

test.describe("privacy between students (BR-10)", () => {
  test("another student gets a 404 for someone else's ticket, in the app and the API", async ({
    page,
    browser,
  }) => {
    const owner = await newStudent();
    const other = await newStudent();
    const { data } = await owner.client
      .rpc("create_ticket", {
        p_title: "Private ticket of the owner",
        p_description: "Nobody but the owner and staff should see this.",
        p_building: "Block A",
        p_room: "",
        p_idempotency_key: randomUUID(),
      })
      .single();
    const ticketId = data?.id ?? "";

    await signInAs(page, other);
    await page.goto(`/student/complaints/${ticketId}`);
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    await expect(page.getByText("Private ticket of the owner")).toHaveCount(0);

    const api = await page.request.get(`/api/complaints/${ticketId}`);
    expect(api.status()).toBe(404);

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAs(ownerPage, owner);
    await ownerPage.goto(`/student/complaints/${ticketId}`);
    await expect(ownerPage.getByRole("heading", { level: 1 })).toHaveText(
      "Private ticket of the owner",
    );
    await ownerContext.close();
  });
});

test.describe("JSON API (plan §11)", () => {
  const body = {
    title: "Projector shows no signal",
    description: "The classroom projector shows no signal with every laptop we tried.",
    building: "Block B",
    room: "105",
  };

  test("POST is idempotent and returns the stable error contract", async ({ page, request }) => {
    const student = await newStudent();
    await signInAs(page, student);
    const key = randomUUID();
    const post = (data: unknown, headers: Record<string, string> = {}) =>
      page.request.post("/api/complaints", {
        data,
        headers: { "idempotency-key": key, ...headers },
      });

    const first = await post(body);
    expect(first.status()).toBe(201);
    const created = (await first.json()) as {
      id: string;
      reference: string;
      status: string;
      created: boolean;
    };
    expect(created).toMatchObject({ status: "submitted", created: true });
    expect(created.reference).toMatch(/^MIR-\d+$/);
    expect(first.headers()["x-request-id"]).toMatch(/^req_/);
    expect(first.headers()["cache-control"]).toBe("no-store");

    const replay = await post(body);
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as { id: string }).id).toBe(created.id);

    const conflict = await post({ ...body, title: "A different report" });
    expect(conflict.status()).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );

    const noKey = await page.request.post("/api/complaints", { data: body });
    expect(noKey.status()).toBe(400);

    const injected = await post(
      { ...body, status: "resolved" },
      { "idempotency-key": randomUUID() },
    );
    expect(injected.status()).toBe(400);

    const crossSite = await post(body, {
      origin: "https://evil.example",
      "idempotency-key": randomUUID(),
    });
    expect(crossSite.status()).toBe(403);

    const formPost = await page.request.post("/api/complaints", {
      form: { title: body.title },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(formPost.status()).toBe(415);

    expect(await complaintCount(student.id)).toBe(1);

    const anonymous = await request.post("/api/complaints", {
      data: body,
      headers: { "idempotency-key": randomUUID() },
    });
    expect(anonymous.status()).toBe(401);
    const errorBody = (await anonymous.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(errorBody.error).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(errorBody.error.requestId).toMatch(/^req_/);
  });

  test("GET returns the caller's tickets and a single ticket with its timeline", async ({
    page,
  }) => {
    const student = await newStudent();
    await signInAs(page, student);
    const created = await page.request.post("/api/complaints", {
      data: body,
      headers: { "idempotency-key": randomUUID() },
    });
    const { id } = (await created.json()) as { id: string };

    const list = await page.request.get("/api/complaints?limit=5");
    expect(list.status()).toBe(200);
    const page1 = (await list.json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(page1.items.map((item) => item.id)).toEqual([id]);
    expect(page1.nextCursor).toBeNull();

    const detail = await page.request.get(`/api/complaints/${id}`);
    expect(detail.status()).toBe(200);
    const ticket = (await detail.json()) as { events: { type: string }[]; description: string };
    expect(ticket.description).toBe(body.description);
    expect(ticket.events.map((event) => event.type)).toEqual(["created"]);

    expect((await page.request.get("/api/complaints?limit=500")).status()).toBe(400);
    expect((await page.request.get("/api/complaints/not-a-uuid")).status()).toBe(404);
  });
});

test.describe("list pagination and filters (P2.06)", () => {
  test("shows 20 per page, pages through older reports, and filters by status", async ({
    page,
  }) => {
    const student = await newStudent();
    // Seed directly with the service role: 25 tickets with distinct timestamps, oldest first.
    const base = Date.UTC(2026, 9, 1, 8, 0, 0);
    const rows = Array.from({ length: 25 }, (_, index) => ({
      created_by: student.id,
      title: `Seeded report ${String(index + 1).padStart(2, "0")}`,
      description: "Seeded to exercise keyset pagination in the list view.",
      building: "Block P",
      created_at: new Date(base + index * 60_000).toISOString(),
      status: index === 0 ? ("resolved" as const) : ("submitted" as const),
    }));
    const { error } = await adminClient().from("complaints").insert(rows);
    expect(error).toBeNull();

    await signInAs(page, student);
    const list = page.getByRole("list", { name: "Complaints" });
    await expect(list.getByRole("listitem")).toHaveCount(20);
    await expect(list.getByRole("listitem").first()).toContainText("Seeded report 25");

    await page.getByRole("link", { name: "Older reports" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("listitem").last()).toContainText("Seeded report 01");
    await expect(page.getByRole("link", { name: "Older reports" })).toHaveCount(0);

    await page.getByRole("link", { name: "Back to newest" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(20);

    const filters = page.getByRole("navigation", { name: "Filter by status" });
    await filters.getByRole("link", { name: "Resolved" }).click();
    await expect(filters.getByRole("link", { name: "Resolved" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Seeded report 01");

    await filters.getByRole("link", { name: "Closed" }).click();
    await expect(page.getByRole("heading", { name: "Nothing to show" })).toBeVisible();
  });

  test("a tampered page link falls back to the newest page instead of failing", async ({
    page,
  }) => {
    const student = await newStudent();
    await signInAs(page, student);
    await page.goto("/student/complaints?cursor=forged&status=nonsense");
    await expect(page.getByRole("heading", { name: "No complaints yet" })).toBeVisible();
  });
});

test.describe("accessibility of complaint pages", () => {
  test("the form, list and detail views have no WCAG 2.1 AA violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const student = await newStudent();
    await signInAs(page, student);

    /**
     * Scans only once the page has finished rendering: its own title and main heading are in
     * place. Scanning the instant the URL changes measured a half-rendered page on slow CI.
     */
    const scanWhenReady = async (title: RegExp, heading: string | RegExp) => {
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual(
        [],
      );
    };

    await scanWhenReady(/^My complaints · MakeItRight$/, /here are your reports/); // empty list
    await page.goto("/student/complaints/new");
    await scanWhenReady(/^Report an issue · MakeItRight$/, "Report an issue");
    await fillReport(page, "Accessibility check report");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page).toHaveURL(/notice=created$/);
    await scanWhenReady(/^Complaint · MakeItRight$/, "Accessibility check report");
    await page.goto("/student/complaints");
    await scanWhenReady(/^My complaints · MakeItRight$/, /here are your reports/);
  });
});
