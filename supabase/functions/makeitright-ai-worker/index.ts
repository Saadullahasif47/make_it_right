/**
 * makeitright-ai-worker: the one consumer of the makeitright_ai_jobs queue (plan v2 §03, §05).
 * Supabase Cron calls it every minute while work is pending, with the shared secret in
 * x-worker-secret. All logic lives in ../_shared/jobs so it is unit-tested in Node; this file
 * only wires the Deno runtime.
 */
import { createJobHandlers } from "../_shared/jobs/handlers.ts";
import { handleWorkerRequest, readWorkerSettings } from "../_shared/jobs/worker.ts";
import { createRestWorkerDatabase } from "../_shared/jobs/worker-db.ts";

interface DenoRuntime {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  readonly env: { get(name: string): string | undefined };
}

const runtime = (globalThis as unknown as { readonly Deno: DenoRuntime }).Deno;

function log(event: string, fields: Readonly<Record<string, unknown>>): void {
  // eslint-disable-next-line no-console -- Edge Functions log to stdout, which Supabase collects; fields hold ids and codes only.
  console.log(JSON.stringify({ level: "info", event, ...fields, ts: new Date().toISOString() }));
}

const configured = readWorkerSettings((name) => runtime.env.get(name));
if (!configured.ok) {
  log("ai_worker.misconfigured", { problem: configured.problem });
}

const handlers = createJobHandlers();

runtime.serve((request) => {
  if (!configured.ok) {
    return Response.json({ error: "WORKER_NOT_CONFIGURED" }, { status: 503 });
  }
  const { settings } = configured;
  return handleWorkerRequest(request, settings, {
    db: createRestWorkerDatabase({
      supabaseUrl: settings.supabaseUrl,
      serviceKey: settings.serviceKey,
      fetch: (input, init) => fetch(input, init),
    }),
    handlers,
    log,
  });
});
