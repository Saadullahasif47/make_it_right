/**
 * Read-only latency probe of a live deployment (master plan P6.02, release gate "a real cloud
 * resource and measured performance results"). It sends 1, 5 and 20 concurrent requests to
 * public endpoints only: no accounts, no writes, no secrets.
 *
 *   node scripts/cloud-latency.mts --base-url https://makeitright-takeasy1.vercel.app
 *
 * Measured paths:
 *   GET /api/health          a Vercel serverless function (reads deployment config)
 *   GET /login               a server-rendered page (CDN shell + streamed content)
 *   POST /api/complaints     signed out: proxy, session check and a 401 from the function
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { percentile } from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://makeitright-takeasy1.vercel.app" },
    "min-samples": { type: "string", default: "20" },
    label: { type: "string", default: "production" },
  },
});
const baseUrl = options["base-url"].replace(/\/+$/, "");
const minSamples = Number(options["min-samples"]);
const levels = [1, 5, 20];

interface Probe {
  readonly name: string;
  readonly expected: number;
  readonly request: () => Promise<Response>;
}

const probes: Probe[] = [
  {
    name: "GET /api/health",
    expected: 200,
    request: () => fetch(`${baseUrl}/api/health`, { cache: "no-store" }),
  },
  {
    name: "GET /login",
    expected: 200,
    request: () => fetch(`${baseUrl}/login`, { cache: "no-store" }),
  },
  {
    name: "POST /api/complaints (signed out)",
    expected: 401,
    request: () =>
      fetch(`${baseUrl}/api/complaints`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: "{}",
      }),
  },
];

async function timed(probe: Probe): Promise<{ ms: number; ok: boolean; status: number }> {
  const started = performance.now();
  try {
    const response = await probe.request();
    await response.arrayBuffer();
    return {
      ms: performance.now() - started,
      ok: response.status === probe.expected,
      status: response.status,
    };
  } catch {
    return { ms: performance.now() - started, ok: false, status: 0 };
  }
}

async function main() {
  const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as {
    version?: string;
    environment?: string;
  };
  console.log(`probing ${baseUrl} (version ${health.version}, ${health.environment})`);
  const rows: string[] = [];
  const json: unknown[] = [];
  for (const probe of probes) {
    await timed(probe); // warm-up, not measured
    for (const level of levels) {
      const results: { ms: number; ok: boolean; status: number }[] = [];
      const waves = Math.max(1, Math.ceil(minSamples / level));
      for (let wave = 0; wave < waves; wave++) {
        results.push(...(await Promise.all(Array.from({ length: level }, () => timed(probe)))));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const latencies = results.map((result) => result.ms);
      const errors = results.filter((result) => !result.ok);
      const row = {
        probe: probe.name,
        level,
        requests: results.length,
        errors: errors.length,
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
        max: Math.round(Math.max(...latencies)),
      };
      json.push(row);
      rows.push(
        `| ${row.probe} | ${row.level} | ${row.requests} | ${row.errors} | ${row.p50} ms | ${row.p95} ms | ${row.max} ms |`,
      );
      console.log(
        `  ${probe.name} x${level}: p50 ${row.p50} ms, p95 ${row.p95} ms, errors ${row.errors}`,
      );
    }
  }
  const markdown = `# Evidence: live cloud latency (${options.label})

Measured on ${new Date().toISOString().slice(0, 10)} from the developer's machine (Pakistan) against
\`${baseUrl}\` (deployment \`${health.version}\`, ${health.environment}) with \`scripts/cloud-latency.mts\`.
Read-only: public endpoints only, no accounts and no data written. Latency includes the network
round trip from the client to Vercel. One unmeasured warm-up request precedes each probe.

| Endpoint | Concurrent | Requests | Errors | p50 | p95 | Max |
| -------- | ---------- | -------- | ------ | --- | --- | --- |
${rows.join("\n")}

"Errors" counts any response other than the expected status (200, or 401 for the signed-out
submission, which proves the function ran its session check).
`;
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(`docs/evidence/p6-cloud-latency-${options.label}.md`, markdown);
  writeFileSync(
    `docs/evidence/p6-cloud-latency-${options.label}.json`,
    `${JSON.stringify(json, null, 2)}\n`,
  );
  console.log(markdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
