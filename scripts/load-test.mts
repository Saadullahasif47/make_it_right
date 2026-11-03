/**
 * Concurrent submission load test (master plan P6.02): 1, 5 and 20 simultaneous report
 * submissions through the real HTTP API, recording p50/p95 latency, errors and idempotency.
 *
 * Each request is a genuine signed-in student's `POST /api/complaints` (session cookie, same-site
 * origin, idempotency key), so it exercises the full path: proxy, session, validation, database
 * function and (when switched on) the AI step. The final wave sends every request twice with the
 * same key at the same moment, to prove duplicates never create a second ticket.
 *
 * Temporary fictional students are created with the secret key and removed afterwards together
 * with their tickets. The target must be local unless --allow-cloud is given explicitly.
 *
 *   node --env-file=.env.local scripts/load-test.mts --base-url http://localhost:3100
 *   options: --levels 1,5,20  --min-samples 20  --label local  --keep  --allow-cloud
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  createTempUser,
  deleteTempUsers,
  isLocalUrl,
  percentile,
  requireEnv,
  serviceClient,
  type TempUser,
} from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string" },
    levels: { type: "string", default: "1,5,20" },
    "min-samples": { type: "string", default: "20" },
    label: { type: "string", default: "local" },
    keep: { type: "boolean", default: false },
    "allow-cloud": { type: "boolean", default: false },
  },
});

const baseUrl = (options["base-url"] ?? "").replace(/\/+$/, "");
if (baseUrl === "") {
  console.error("Pass --base-url, for example --base-url http://localhost:3100");
  process.exit(1);
}
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
if ((!isLocalUrl(baseUrl) || !isLocalUrl(supabaseUrl)) && !options["allow-cloud"]) {
  console.error("Refusing a non-local target. Pass --allow-cloud only with the owner's approval.");
  process.exit(1);
}

const levels = options.levels.split(",").map((level) => Number(level.trim()));
const minSamples = Number(options["min-samples"]);
const studentCount = Math.max(...levels);
const runId = randomUUID().slice(0, 8);
const admin = serviceClient();

interface Sample {
  readonly level: number;
  readonly wave: number;
  readonly status: number;
  readonly ms: number;
  readonly ticketId: string | undefined;
  readonly created: boolean | undefined;
  readonly key: string;
  readonly duplicate: boolean;
}

function createStudents(): Promise<TempUser[]> {
  return Promise.all(
    Array.from({ length: studentCount }, (_, index) =>
      createTempUser(`load-${runId}-${index}`, "student"),
    ),
  );
}

async function submit(
  student: TempUser,
  key: string,
  level: number,
  wave: number,
  duplicate: boolean,
): Promise<Sample> {
  const body = {
    title: `Load test ${level}-${wave}`,
    description: "A fictional report sent by the Phase 6 load test. Please ignore.",
    building: "Load Block",
    room: String(wave),
  };
  const started = performance.now();
  let status = 0;
  let ticketId: string | undefined;
  let created: boolean | undefined;
  try {
    const response = await fetch(`${baseUrl}/api/complaints`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        cookie: student.cookie,
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    status = response.status;
    const json = (await response.json()) as { id?: string; created?: boolean };
    ticketId = json.id;
    created = json.created;
  } catch {
    status = 0; // network failure
  }
  return {
    level,
    wave,
    status,
    ms: performance.now() - started,
    ticketId,
    created,
    key,
    duplicate,
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(
    `load test ${runId}: ${baseUrl}, levels ${levels.join("/")}, ${studentCount} temporary students`,
  );
  const students = await createStudents();
  const samples: Sample[] = [];
  const wallTimes = new Map<number, number>();
  let rotation = 0;

  try {
    // Warm-up (not measured): first requests compile routes and open connections.
    await fetch(`${baseUrl}/api/health`);
    const warm = students[0];
    if (warm !== undefined) await submit(warm, randomUUID(), 0, 0, false);

    for (const level of levels) {
      const waves = Math.max(1, Math.ceil(minSamples / level));
      let wall = 0;
      for (let wave = 1; wave <= waves; wave++) {
        // Rotate through the students so nobody approaches the 20-per-10-minutes limit.
        const batch = Array.from(
          { length: level },
          () => students[rotation++ % students.length],
        ).filter((student): student is TempUser => student !== undefined);
        const started = performance.now();
        samples.push(
          ...(await Promise.all(
            batch.map((student) => submit(student, randomUUID(), level, wave, false)),
          )),
        );
        wall += performance.now() - started;
        await pause(300);
      }
      wallTimes.set(level, wall);
      console.log(`  level ${level}: ${waves} wave(s) done`);
    }

    // Idempotency under load: every request sent twice, simultaneously, with one key.
    const top = Math.max(...levels);
    const pairs = students.slice(0, top).flatMap((student) => {
      const key = randomUUID();
      return [submit(student, key, top, 99, false), submit(student, key, top, 99, true)];
    });
    samples.push(...(await Promise.all(pairs)));
    console.log(`  idempotency wave: ${pairs.length} requests (${top} pairs)`);

    // Ground truth from the database.
    const ids = students.map((student) => student.id);
    const { data: tickets } = await admin.from("complaints").select("id").in("created_by", ids);
    const { data: events } = await admin
      .from("ticket_events")
      .select("complaint_id")
      .eq("event_type", "created")
      .in(
        "complaint_id",
        (tickets ?? []).map((ticket) => ticket.id),
      );

    const report = summarise(samples, wallTimes, tickets?.length ?? 0, events?.length ?? 0, top);
    write(report);
  } finally {
    if (!options.keep) {
      await deleteTempUsers(students.map((student) => student.id));
      console.log("  cleaned up temporary students and their tickets");
    }
  }
}

function summarise(
  samples: readonly Sample[],
  wallTimes: ReadonlyMap<number, number>,
  ticketsInDb: number,
  createdEvents: number,
  top: number,
) {
  const measured = samples.filter((sample) => sample.wave !== 99);
  const rows = levels.map((level) => {
    const set = measured.filter((sample) => sample.level === level);
    const ok = set.filter((sample) => sample.status === 201);
    const latencies = set.map((sample) => sample.ms);
    const errors = new Map<number, number>();
    for (const sample of set)
      if (sample.status !== 201) errors.set(sample.status, (errors.get(sample.status) ?? 0) + 1);
    const wall = wallTimes.get(level) ?? 0;
    return {
      level,
      requests: set.length,
      succeeded: ok.length,
      errors: Object.fromEntries(errors),
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      max: Math.round(Math.max(0, ...latencies)),
      throughput: wall === 0 ? 0 : Math.round((set.length / (wall / 1000)) * 10) / 10,
    };
  });

  const pairs = samples.filter((sample) => sample.wave === 99);
  const byKey = new Map<string, Sample[]>();
  for (const sample of pairs) byKey.set(sample.key, [...(byKey.get(sample.key) ?? []), sample]);
  const pairResults = [...byKey.values()];
  const sameTicket = pairResults.filter(
    (pair) =>
      pair.length === 2 &&
      pair[0]?.ticketId !== undefined &&
      pair[0].ticketId === pair[1]?.ticketId,
  ).length;
  const exactlyOneCreated = pairResults.filter(
    (pair) => pair.filter((sample) => sample.created === true).length === 1,
  ).length;
  const successfulSubmissions =
    measured.filter((sample) => sample.status === 201).length + pairResults.length + 1; // +1 warm-up

  return {
    runId,
    label: options.label,
    target: baseUrl,
    date: new Date().toISOString(),
    rows,
    idempotency: { pairs: pairResults.length, sameTicket, exactlyOneCreated, expected: top },
    database: { ticketsInDb, createdEvents, expectedTickets: successfulSubmissions },
  };
}

function write(report: ReturnType<typeof summarise>) {
  const errorText = (errors: Record<string, number>) =>
    Object.keys(errors).length === 0
      ? "0"
      : Object.entries(errors)
          .map(([status, n]) => `${n} × HTTP ${status}`)
          .join(", ");
  const markdown = `# Evidence: concurrent submission load test (${report.label})

Run \`${report.runId}\` on ${report.date.slice(0, 10)} against \`${report.target}\` with
\`scripts/load-test.mts\`. Every request is a signed-in student's \`POST /api/complaints\` through
the full stack (session cookie, validation, database function). Latency is measured at the client,
end to end. One unmeasured warm-up request runs first.

| Concurrent submissions | Requests | Succeeded (201) | Errors | p50 | p95 | Max | Throughput |
| ---------------------- | -------- | --------------- | ------ | --- | --- | --- | ---------- |
${report.rows.map((row) => `| ${row.level} | ${row.requests} | ${row.succeeded} | ${errorText(row.errors)} | ${row.p50} ms | ${row.p95} ms | ${row.max} ms | ${row.throughput} req/s |`).join("\n")}

## Idempotency under load

${report.idempotency.pairs} keys were each sent twice at the same instant (${report.idempotency.pairs * 2} requests).

- Both requests of a pair returned the same ticket: **${report.idempotency.sameTicket} / ${report.idempotency.expected}**
- Exactly one request per pair reported \`created: true\`: **${report.idempotency.exactlyOneCreated} / ${report.idempotency.expected}**

## Database ground truth

- Tickets stored for the temporary students: **${report.database.ticketsInDb}** (expected ${report.database.expectedTickets})
- \`created\` audit events for those tickets: **${report.database.createdEvents}** (one per ticket)

The temporary students and their tickets were deleted after the run.
`;
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(`docs/evidence/p6-load-${report.label}.md`, markdown);
  writeFileSync(
    `docs/evidence/p6-load-${report.label}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(markdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
