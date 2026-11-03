/**
 * Failure drills (master plan P6.03-P6.05), run against the LOCAL stack only. Each drill breaks
 * one thing on purpose, submits through the real HTTP API (or the real browser form), and then
 * checks the database for the exact outcome:
 *
 *   1. AI switched on but no Gemini key        -> ticket stored, sent for review, no data loss
 *   2. Gemini unreachable                       -> same, with a provider failure code
 *   3. The database write itself fails          -> visible failure, no ticket, no false success
 *   4. Ten simultaneous duplicate submissions   -> exactly one ticket and one audit event
 *   5. Two staff change one ticket at once      -> one succeeds, one gets 409, one audit event
 *
 *   node --env-file=.env.local scripts/failure-drills.mts --base-url http://localhost:3100
 *
 * --base-url must be a running production build with AI off (pnpm build && pnpm start). The
 * drills start two extra servers themselves (ports 3102 and 3103) with deliberately broken AI
 * settings, and add then remove a fault trigger in the local database (docker exec).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";

import {
  createTempUser,
  deleteTempUsers,
  isLocalUrl,
  requireEnv,
  serviceClient,
  type TempUser,
} from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:3100" },
    "db-container": { type: "string", default: "supabase_db_makeitright" },
  },
});

const baseUrl = options["base-url"].replace(/\/+$/, "");
if (!isLocalUrl(baseUrl) || !isLocalUrl(requireEnv("NEXT_PUBLIC_SUPABASE_URL"))) {
  console.error("Failure drills run against the local stack only.");
  process.exit(1);
}
const admin = serviceClient();
const cleanup: string[] = [];
const results: { drill: string; checks: { name: string; ok: boolean; detail: string }[] }[] = [];

function record(drill: string, checks: { name: string; ok: boolean; detail: string }[]) {
  results.push({ drill, checks });
  for (const check of checks)
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
}

function sql(statement: string): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      options["db-container"],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
    {
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
}

async function submit(
  base: string,
  user: TempUser,
  key = randomUUID(),
  title = "Drill: corridor light flickering",
) {
  const response = await fetch(`${base}/api/complaints`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      cookie: user.cookie,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      title,
      description: "One tube light in the corridor flickers on and off. Fictional drill report.",
      building: "Drill Block",
      room: "1",
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function waitForHealth(base: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${base} did not become healthy`);
}

function startServer(port: number, env: Record<string, string>): ChildProcess {
  return spawn(`pnpm start --port ${port}`, {
    env: { ...process.env, ...env },
    shell: true,
    stdio: "ignore",
  });
}

function stopServer(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function ticketState(id: string) {
  const [{ data: ticket }, { data: events }, { data: runs }] = await Promise.all([
    admin.from("complaints").select("status, version").eq("id", id).single(),
    admin.from("ticket_events").select("event_type").eq("complaint_id", id).order("id"),
    admin.from("agent_runs").select("outcome, failure_code").eq("complaint_id", id),
  ]);
  return { ticket, events: (events ?? []).map((event) => event.event_type), runs: runs ?? [] };
}

/* Drills 1 and 2: the AI provider fails ------------------------------------------------------ */
async function aiDrill(
  drill: string,
  port: number,
  env: Record<string, string>,
  expectedCode: string,
  student: TempUser,
) {
  console.log(`\n${drill}`);
  const server = startServer(port, {
    AI_ENABLED: "true",
    APP_BASE_URL: `http://localhost:${port}`,
    ...env,
  });
  try {
    const base = `http://localhost:${port}`;
    await waitForHealth(base);
    const started = performance.now();
    const { status, body } = await submit(base, student);
    const ms = Math.round(performance.now() - started);
    const id = typeof body.id === "string" ? body.id : "";
    const state = await ticketState(id);
    record(drill, [
      { name: "the report is accepted", ok: status === 201, detail: `HTTP ${status} in ${ms} ms` },
      {
        name: "the ticket is stored and waits for review",
        ok: state.ticket?.status === "needs_review",
        detail: `status ${state.ticket?.status}`,
      },
      {
        name: "the failure is recorded with a stable code",
        ok: state.runs[0]?.failure_code === expectedCode,
        detail: `${state.runs[0]?.failure_code}`,
      },
      {
        name: "the audit trail is complete",
        ok: state.events.join(",") === "created,triage_started,review_requested",
        detail: state.events.join(" → "),
      },
    ]);
  } finally {
    stopServer(server);
  }
}

/* Drill 3: the database write fails ------------------------------------------------------------ */
async function databaseFailureDrill(student: TempUser) {
  const drill = "3. The database write fails (fault injected on insert)";
  console.log(`\n${drill}`);
  const before = await admin
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("created_by", student.id);
  const key = randomUUID();
  sql(`create or replace function public.zz_drill_fail() returns trigger language plpgsql as $$ begin raise exception 'simulated storage failure' using errcode = 'XX000'; end $$;
       create trigger zz_drill_fail before insert on public.complaints for each row execute function public.zz_drill_fail();`);
  let apiStatus = 0;
  let apiBody: Record<string, unknown> = {};
  let screenshot = "";
  let uiStayedOnForm = false;
  let uiMessage = "";
  try {
    ({ status: apiStatus, body: apiBody } = await submit(baseUrl, student, key));

    // The same failure through the real form, as a student sees it.
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      await page.goto(`${baseUrl}/login`);
      await page.getByLabel("Email").fill(student.email);
      await page.getByLabel("Password", { exact: true }).fill(student.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/student\/complaints$/);
      await page.goto(`${baseUrl}/student/complaints/new`);
      await page.getByLabel("What is wrong?").fill("Drill: socket not working");
      await page.getByLabel("Building").fill("Drill Block");
      await page
        .getByLabel("Describe the problem")
        .fill("The wall socket by desk 4 has no power. Fictional drill report.");
      await page.getByRole("button", { name: "Submit report" }).click();
      const alert = page.getByRole("main").getByRole("alert");
      await alert.waitFor({ timeout: 15_000 });
      uiMessage = (await alert.innerText()).trim();
      uiStayedOnForm =
        page.url().endsWith("/student/complaints/new") &&
        (await page.getByLabel("What is wrong?").inputValue()) === "Drill: socket not working";
      mkdirSync("docs/evidence", { recursive: true });
      screenshot = "docs/evidence/p6-drill-database-failure.png";
      await page.screenshot({ path: screenshot, fullPage: false });
    } finally {
      await browser.close();
    }
  } finally {
    sql(
      "drop trigger if exists zz_drill_fail on public.complaints; drop function if exists public.zz_drill_fail();",
    );
  }
  const after = await admin
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("created_by", student.id);
  const { count: keys } = await admin
    .from("submission_keys")
    .select("idempotency_key", { count: "exact", head: true })
    .eq("idempotency_key", key);
  const retry = await submit(baseUrl, student, key);

  record(drill, [
    {
      name: "the API reports a failure, never success",
      ok: apiStatus === 503 && apiBody.id === undefined,
      detail: `HTTP ${apiStatus}, code ${String((apiBody.error as { code?: string } | undefined)?.code)}`,
    },
    {
      name: "no ticket was stored",
      ok: (after.count ?? -1) === (before.count ?? -2),
      detail: `${before.count} before, ${after.count} after`,
    },
    { name: "no idempotency key was consumed", ok: keys === 0, detail: `${keys} keys stored` },
    {
      name: "the form shows the error and keeps the student's text",
      ok: uiStayedOnForm && uiMessage.length > 0,
      detail: `"${uiMessage}"`,
    },
    {
      name: "once storage recovers, the same submission succeeds",
      ok: retry.status === 201 && retry.body.created === true,
      detail: `HTTP ${retry.status}`,
    },
  ]);
  return screenshot;
}

/* Drill 4: duplicate submissions ---------------------------------------------------------------- */
async function duplicateDrill(student: TempUser) {
  const drill = "4. Ten simultaneous duplicate submissions (one idempotency key)";
  console.log(`\n${drill}`);
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => submit(baseUrl, student, key, "Drill: duplicate submit")),
  );
  const ids = new Set(responses.map((response) => String(response.body.id)));
  const created = responses.filter((response) => response.body.created === true).length;
  const id = [...ids][0] ?? "";
  const { data: events } = await admin
    .from("ticket_events")
    .select("event_type")
    .eq("complaint_id", id)
    .eq("event_type", "created");
  const { count: tickets } = await admin
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("created_by", student.id)
    .eq("title", "Drill: duplicate submit");
  record(drill, [
    {
      name: "every response points to the same ticket",
      ok: ids.size === 1,
      detail: `${ids.size} distinct id(s)`,
    },
    {
      name: "exactly one response says created",
      ok: created === 1,
      detail: `${created} created, ${10 - created} replays (${responses.map((response) => response.status).join(",")})`,
    },
    { name: "exactly one ticket is stored", ok: tickets === 1, detail: `${tickets} ticket(s)` },
    {
      name: "exactly one 'created' audit event",
      ok: events?.length === 1,
      detail: `${events?.length} event(s)`,
    },
  ]);
}

/* Drill 5: two staff, one ticket ---------------------------------------------------------------- */
async function staleVersionDrill(
  student: TempUser,
  adminUser: TempUser,
  staffA: TempUser,
  staffB: TempUser,
) {
  const drill = "5. Two electrical staff start work on the same ticket at the same moment";
  console.log(`\n${drill}`);
  const { body } = await submit(baseUrl, student, randomUUID(), "Drill: stale version");
  const id = String(body.id);
  const { data: electrical } = await admin
    .from("departments")
    .select("id")
    .eq("code", "electrical")
    .single();
  const review = await fetch(`${baseUrl}/api/complaints/${id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: adminUser.cookie },
    body: JSON.stringify({
      departmentId: electrical?.id,
      category: "electrical",
      priority: "medium",
      expectedVersion: 1,
    }),
  });
  const assigned = (await review.json()) as { version?: number };
  const change = (user: TempUser) =>
    fetch(`${baseUrl}/api/complaints/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: baseUrl, cookie: user.cookie },
      body: JSON.stringify({ target: "in_progress", expectedVersion: assigned.version }),
    }).then(async (response) => ({
      status: response.status,
      body: (await response.json()) as { error?: { code?: string } },
    }));
  const [a, b] = await Promise.all([change(staffA), change(staffB)]);
  const statuses = [a.status, b.status].sort();
  const loser = a.status === 409 ? a : b;
  const state = await ticketState(id);
  const workEvents = state.events.filter((event) => event === "status_changed").length;
  record(drill, [
    {
      name: "the admin assignment succeeds",
      ok: review.status === 200,
      detail: `HTTP ${review.status}, version ${assigned.version}`,
    },
    {
      name: "exactly one change wins, the other gets 409",
      ok: statuses.join(",") === "200,409",
      detail: `HTTP ${statuses.join(" and ")}`,
    },
    {
      name: "the loser is told the ticket changed",
      ok: loser.body.error?.code === "STALE_VERSION",
      detail: `${loser.body.error?.code}`,
    },
    {
      name: "the ticket moved forward exactly once",
      ok:
        state.ticket?.status === "in_progress" &&
        state.ticket.version === (assigned.version ?? 0) + 1,
      detail: `status ${state.ticket?.status}, version ${state.ticket?.version}`,
    },
    {
      name: "exactly one audit event for the change",
      ok: workEvents === 1,
      detail: `${workEvents} status_changed event(s)`,
    },
  ]);
}

function writeReport(screenshot: string) {
  const all = results.flatMap((result) => result.checks);
  const passed = all.filter((check) => check.ok).length;
  const sections = results
    .map(
      (result) => `### ${result.drill}

| Check | Result | Observed |
| ----- | ------ | -------- |
${result.checks.map((check) => `| ${check.name} | ${check.ok ? "PASS" : "**FAIL**"} | ${check.detail.replaceAll("|", "/")} |`).join("\n")}`,
    )
    .join("\n\n");
  const markdown = `# Evidence: failure drills (local stack)

Run on ${new Date().toISOString().slice(0, 10)} with \`scripts/failure-drills.mts\` against \`${baseUrl}\`
(production build, local Supabase). Faults were injected on purpose and removed afterwards.

**${passed} / ${all.length} checks passed.**

${sections}
${screenshot === "" ? "" : `\nWhat the student sees when storage fails (drill 3):\n\n![Database failure drill](${screenshot.replace("docs/evidence/", "")})\n`}`;
  writeFileSync("docs/evidence/p6-drills.md", markdown);
  console.log(`\n${passed} / ${all.length} checks passed`);
  return passed === all.length;
}

async function main() {
  await waitForHealth(baseUrl);
  const [student, adminUser, staffA, staffB] = await Promise.all([
    createTempUser("drill-student", "student"),
    createTempUser("drill-admin", "admin"),
    createTempUser("drill-staff-a", "department", "electrical"),
    createTempUser("drill-staff-b", "department", "electrical"),
  ]);
  cleanup.push(student.id, adminUser.id, staffA.id, staffB.id);
  let screenshot = "";
  try {
    await aiDrill(
      "1. AI switched on, but no Gemini key configured",
      3102,
      { GEMINI_API_KEY: "" },
      "PROVIDER_NOT_CONFIGURED",
      student,
    );
    await aiDrill(
      "2. Gemini unreachable (provider down)",
      3103,
      { GEMINI_API_KEY: "drill-key-not-real", GEMINI_BASE_URL: "http://127.0.0.1:9" },
      "PROVIDER_UNAVAILABLE",
      student,
    );
    screenshot = await databaseFailureDrill(student);
    await duplicateDrill(student);
    await staleVersionDrill(student, adminUser, staffA, staffB);
  } finally {
    await deleteTempUsers(cleanup);
  }
  if (!writeReport(screenshot)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
