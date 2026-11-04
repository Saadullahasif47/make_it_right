/**
 * Design audit of the signed-in student screens (UI redesign plan §6, Stage 3 gate), against a
 * LOCAL build only: `pnpm build`, `pnpm start --port 3100`, then
 *
 *   node scripts/design-audit-student.mts --label after
 *
 * It creates a throwaway fictional student on the local stack, files four reports through the
 * real API (so each has its timeline), moves two of them on with the service role, audits the
 * list, a search, the report form and a resolved ticket, then deletes the student again.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { parseWidths, runAudit } from "./lib/design-audit.mts";
import { createTempUser, deleteTempUsers, isLocalUrl, serviceClient } from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:3100" },
    label: { type: "string", default: "after" },
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

async function main() {
  if (!isLocalUrl(baseUrl)) {
    throw new Error("This audit creates and deletes accounts, so it only runs against localhost.");
  }
  if (process.env.SUPABASE_SECRET_KEY === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  const student = await createTempUser("audit-student", "student");
  try {
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
          description: "Filed by the design audit to show a realistic student list.",
        }),
      });
      if (response.status !== 201) {
        throw new Error(`creating a report failed: HTTP ${response.status}`);
      }
      ids.push(((await response.json()) as { id: string }).id);
    }

    // Move two tickets on so the list, the summary and the reporter's decision all show.
    const admin = serviceClient();
    const { data: electrical } = await admin
      .from("departments")
      .select("id")
      .eq("code", "electrical")
      .single();
    for (const [index, status] of [
      [0, "resolved"],
      [2, "in_progress"],
    ] as const) {
      const { error } = await admin
        .from("complaints")
        .update({ status, assigned_department_id: electrical?.id ?? null, category: "electrical" })
        .eq("id", ids[index] ?? "");
      if (error !== null) throw new Error(`moving a ticket on failed: ${error.message}`);
    }

    const clean = await runAudit({
      baseUrl,
      label: options.label,
      pages: [
        { path: "/student/complaints", name: "student-list" },
        { path: "/student/complaints?q=library", name: "student-search" },
        { path: "/student/complaints/new", name: "student-new" },
        { path: `/student/complaints/${ids[0] ?? ""}`, name: "student-ticket-resolved" },
      ],
      widths: parseWidths(options.widths),
      darkWidths: parseWidths(options["dark-widths"]),
      prepare: async (page) => {
        await page.goto(`${baseUrl}/login`);
        await page.getByLabel("Email").fill(student.email);
        await page.getByLabel("Password", { exact: true }).fill(student.password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL(/\/student\/complaints$/);
      },
    });
    if (!clean) process.exitCode = 1;
  } finally {
    await deleteTempUsers([student.id]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
