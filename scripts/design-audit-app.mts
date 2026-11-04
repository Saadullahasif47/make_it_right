/**
 * Design audit of the signed-in screens (UI redesign plan §6, Stage 3 and 4 gates), against a
 * LOCAL build only: `pnpm build`, `pnpm start --port 3100`, then
 *
 *   pnpm design:audit:app --label after                       # every role
 *   pnpm design:audit:app --label after --roles student
 *
 * It creates throwaway fictional accounts on the local stack (a student, an Electrical staff
 * member and an admin), files four reports through the real API so each has its timeline, moves
 * them on with the service role, audits each role's screens, then deletes the accounts again.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { parseWidths, runAudit, type AuditPage } from "./lib/design-audit.mts";
import {
  createTempUser,
  deleteTempUsers,
  isLocalUrl,
  serviceClient,
  type Role,
  type TempUser,
} from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:3100" },
    label: { type: "string", default: "after" },
    roles: { type: "string", default: "student,department,admin" },
    widths: { type: "string", default: "390,768,1366,1440" },
    "dark-widths": { type: "string", default: "390,1440" },
  },
});
const baseUrl = options["base-url"].replace(/\/+$/, "");

const REPORTS = [
  { title: "Ceiling fan not working", building: "Block C", room: "214" },
  { title: "Leaking tap by the window", building: "Chemistry Lab", room: "" },
  { title: "Projector flickers during lectures", building: "Library", room: "Seminar 3" },
  { title: "Broken chair in the reading area", building: "Library", room: "" },
] as const;

/** Files the reports as the student and moves three of them on; returns their ids in order. */
async function seedTickets(student: TempUser): Promise<string[]> {
  const ids: string[] = [];
  for (const report of REPORTS) {
    const response = await fetch(`${baseUrl}/api/complaints`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: student.cookie,
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        ...report,
        description: "Filed by the design audit to show realistic lists and tickets.",
      }),
    });
    if (response.status !== 201) {
      throw new Error(`creating a report failed: HTTP ${response.status}`);
    }
    ids.push(((await response.json()) as { id: string }).id);
  }

  const admin = serviceClient();
  const { data: electrical } = await admin
    .from("departments")
    .select("id")
    .eq("code", "electrical")
    .single();
  const moves = [
    { index: 0, status: "resolved", priority: "medium" },
    { index: 1, status: "assigned", priority: "high" },
    { index: 2, status: "in_progress", priority: "low" },
  ] as const;
  for (const { index, status, priority } of moves) {
    const { error } = await admin
      .from("complaints")
      .update({
        status,
        priority,
        category: "electrical",
        assigned_department_id: electrical?.id ?? null,
      })
      .eq("id", ids[index] ?? "");
    if (error !== null) throw new Error(`moving a ticket on failed: ${error.message}`);
  }
  return ids;
}

function pagesFor(role: Role, ids: readonly string[]): AuditPage[] {
  const [resolved = "", assigned = ""] = ids;
  switch (role) {
    case "student":
      return [
        { path: "/student/complaints", name: "student-list" },
        { path: "/student/complaints?q=library", name: "student-search" },
        { path: "/student/complaints/new", name: "student-new" },
        { path: `/student/complaints/${resolved}`, name: "student-ticket-resolved" },
      ];
    case "department":
      return [
        { path: "/department", name: "staff-queue" },
        { path: `/department?ticket=${assigned}`, name: "staff-queue-panel" },
        { path: `/department/${assigned}`, name: "staff-ticket" },
      ];
    case "admin":
      return [
        { path: "/admin", name: "admin-overview" },
        { path: "/admin/tickets", name: "admin-tickets" },
        { path: "/admin/review", name: "admin-review" },
        { path: `/admin/complaints/${assigned}`, name: "admin-ticket" },
        { path: "/admin/departments", name: "admin-departments" },
      ];
  }
}

const HOMES: Readonly<Record<Role, RegExp>> = {
  student: /\/student\/complaints$/,
  department: /\/department$/,
  admin: /\/admin$/,
};

async function main() {
  if (!isLocalUrl(baseUrl)) {
    throw new Error("This audit creates and deletes accounts, so it only runs against localhost.");
  }
  if (process.env.SUPABASE_SECRET_KEY === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const roles = options.roles.split(",") as Role[];

  const accounts: Record<Role, TempUser> = {
    student: await createTempUser("audit-student", "student"),
    department: await createTempUser("audit-staff", "department", "electrical"),
    admin: await createTempUser("audit-admin", "admin"),
  };
  try {
    const ids = await seedTickets(accounts.student);
    let clean = true;
    for (const role of roles) {
      const account = accounts[role];
      // Every role is audited even after a failure, so one run reports everything.
      const roleClean = await runAudit({
        baseUrl,
        label: options.label,
        pages: pagesFor(role, ids),
        widths: parseWidths(options.widths),
        darkWidths: parseWidths(options["dark-widths"]),
        prepare: async (page) => {
          await page.goto(`${baseUrl}/login`);
          await page.getByLabel("Email").fill(account.email);
          await page.getByLabel("Password", { exact: true }).fill(account.password);
          await page.getByRole("button", { name: "Sign in" }).click();
          await page.waitForURL(HOMES[role]);
        },
      });
      clean = clean && roleClean;
    }
    if (!clean) process.exitCode = 1;
  } finally {
    await deleteTempUsers(Object.values(accounts).map((account) => account.id));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
