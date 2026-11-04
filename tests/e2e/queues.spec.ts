/**
 * Staff and admin ticket tables (UI redesign Stage 4): the department queue's inspection panel
 * on desktop, the full ticket page on phones, and the admin's table of every ticket.
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

import { LOCAL_STACK_REASON, hasLocalStack, signIn, ticketRows } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const cleanup: string[] = [];

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

async function user(role: "student" | "department" | "admin"): Promise<TestUser> {
  const created = await createTestUser(role, role === "department" ? "electrical" : undefined);
  cleanup.push(created.id);
  return created;
}

/** A ticket already routed to Electrical, as the review queue or the AI would leave it. */
async function assignedTicket(owner: TestUser, title: string) {
  const { data, error } = await adminClient()
    .from("complaints")
    .insert({
      created_by: owner.id,
      title,
      description: "Seeded to exercise the department queue and the admin table.",
      building: "Block Q",
      room: "7",
      status: "assigned",
      category: "electrical",
      priority: "high",
      assigned_department_id: await departmentId("electrical"),
    })
    .select("id, reference_no")
    .single();
  expect(error).toBeNull();
  return { id: data?.id ?? "", reference: `MIR-${data?.reference_no ?? 0}` };
}

async function signInAs(page: Page, account: TestUser, home: RegExp): Promise<void> {
  await page.goto("/login");
  await signIn(page, account.email, account.password);
  await expect(page).toHaveURL(home);
}

const inspector = (page: Page, title: string) => page.getByRole("region", { name: title });

test.describe("department queue (Stage 4)", () => {
  test("on desktop a row opens the inspection panel, which acts in place and is shareable", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "The inspection panel is the desktop interaction.");
    const [student, staff] = await Promise.all([user("student"), user("department")]);
    const title = `Panel ${randomUUID().slice(0, 8)}`;
    const ticket = await assignedTicket(student, title);

    await signInAs(page, staff, /\/department$/);
    const row = ticketRows(page).filter({ hasText: title });
    await expect(row.getByText("New", { exact: true })).toBeVisible();
    await expect(row.getByText("High priority")).toBeVisible();
    await row.getByRole("link", { name: title }).click();

    await expect(page).toHaveURL(new RegExp(`/department\\?ticket=${ticket.id}$`));
    const panel = inspector(page, title);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(ticket.reference)).toBeVisible();
    await expect(row.getByRole("link", { name: title })).toHaveAttribute("aria-current", "true");
    // Beside the panel the row is compact, but still marks the ticket as new.
    await expect(row.getByText("New", { exact: true })).toBeVisible();

    // Acting in the panel keeps the queue and the panel; the row reflects the change.
    await panel.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/department\\?ticket=${ticket.id}&notice=acknowledged$`),
    );
    await expect(inspector(page, title)).toBeVisible();
    await expect(row.getByText("New", { exact: true })).toHaveCount(0);
    await expect(
      inspector(page, title).getByRole("list", { name: "Ticket history" }),
    ).toContainText("Acknowledged");

    // The URL is the view: a reload, or a colleague opening it, shows the same panel.
    await page.goto(`/department?ticket=${ticket.id}`);
    await expect(inspector(page, title)).toBeVisible();

    await inspector(page, title).getByRole("link", { name: "Open the full ticket page" }).click();
    await expect(page).toHaveURL(new RegExp(`/department/${ticket.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    await page.goto(`/department?ticket=${ticket.id}`);
    await inspector(page, title).getByRole("link", { name: "Close the ticket panel" }).click();
    await expect(page).toHaveURL(/\/department$/);
    await expect(page.getByRole("region", { name: title })).toHaveCount(0);
  });

  test("on a phone a row opens the full ticket page", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phones open the full page instead of the panel.");
    const [student, staff] = await Promise.all([user("student"), user("department")]);
    const title = `Phone ${randomUUID().slice(0, 8)}`;
    const ticket = await assignedTicket(student, title);

    await signInAs(page, staff, /\/department$/);
    await ticketRows(page).filter({ hasText: title }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/department/${ticket.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  });

  test("a forged or foreign ticket id opens no panel", async ({ page }) => {
    const staff = await user("department");
    await signInAs(page, staff, /\/department$/);
    await page.goto(`/department?ticket=${randomUUID()}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Close the ticket panel" })).toHaveCount(0);
    await page.goto("/department?ticket=not-a-uuid");
    await expect(page.getByRole("link", { name: "Close the ticket panel" })).toHaveCount(0);
  });
});

test.describe("admin tickets table (Stage 4)", () => {
  test("an admin searches every ticket, filters, and opens one; staff cannot use the page", async ({
    page,
    isMobile,
  }) => {
    const [student, admin, staff] = await Promise.all([
      user("student"),
      user("admin"),
      user("department"),
    ]);
    const title = `Admin table ${randomUUID().slice(0, 8)}`;
    const ticket = await assignedTicket(student, title);

    await signInAs(page, admin, /\/admin$/);
    await page.getByRole("link", { name: "Tickets", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/tickets$/);

    const search = page.getByRole("searchbox", { name: "Search all tickets" });
    await search.fill(ticket.reference);
    await page.getByRole("search").getByRole("button", { name: "Search" }).click();
    const rows = ticketRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(title);
    if (!isMobile) {
      await expect(
        rows.first().getByRole("cell", { name: "Electrical Maintenance" }),
      ).toBeVisible();
    }

    // The filter keeps the search: this ticket is not closed.
    await page
      .getByRole("navigation", { name: "Filter by status" })
      .getByRole("link", { name: "Closed" })
      .click();
    await expect(page).toHaveURL(/[?&]q=MIR-\d+/);
    await expect(page.getByRole("heading", { name: "No matching tickets" })).toBeVisible();
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/admin\/tickets\?status=closed$/);

    await page.goto(`/admin/tickets?q=${encodeURIComponent(title)}`);
    await ticketRows(page).first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/complaints/${UUID.source}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    await page.context().clearCookies();
    await signInAs(page, staff, /\/department$/);
    await page.goto("/admin/tickets");
    await expect(
      page.getByRole("heading", { name: "You do not have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Complaints" })).toHaveCount(0);
  });
});
