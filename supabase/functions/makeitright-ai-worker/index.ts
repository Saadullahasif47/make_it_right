/**
 * makeitright-ai-worker: the one consumer of the makeitright_ai_jobs queue (plan v2 §03, §05).
 * Supabase Cron calls it every minute while work is pending, with the shared secret in
 * x-worker-secret. All logic lives in ../_shared/jobs so it is unit-tested in Node; this file
 * only wires the Deno runtime.
 */
import { createCoordinationHandler } from "../_shared/coordination/handler.ts";
import { createJobHandlers } from "../_shared/jobs/handlers.ts";
import {
  handleWorkerRequest,
  readWorkerSettings,
  type WorkerSettings,
} from "../_shared/jobs/worker.ts";
import { createRestRpc, createRestWorkerDatabase } from "../_shared/jobs/worker-db.ts";
import {
  createDuplicateMatchHandler,
  createEmbeddingHandler,
} from "../_shared/duplicates/handlers.ts";
import { createVisualAnalysisHandler } from "../_shared/visual-inspection/handler.ts";

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

const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

/** One handler per feature that has shipped; the rest send their jobs to review. */
function handlersFor(settings: WorkerSettings) {
  const { ai } = settings;
  const rpc = createRestRpc({
    supabaseUrl: settings.supabaseUrl,
    serviceKey: settings.serviceKey,
    fetch: runtimeFetch,
  });
  // The same switch and key serve every AI call; each feature has its own model.
  const provider = (model: string) =>
    !ai.enabled
      ? ({ unavailable: "AI_DISABLED" } as const)
      : ai.apiKey === undefined
        ? ({ unavailable: "PROVIDER_NOT_CONFIGURED" } as const)
        : { apiKey: ai.apiKey, model, baseUrl: ai.baseUrl, fetch: runtimeFetch };
  const duplicates = { rpc, embedding: provider(ai.embeddingModel), model: ai.embeddingModel };

  return createJobHandlers({
    visual_analysis: createVisualAnalysisHandler({
      rpc,
      supabaseUrl: settings.supabaseUrl,
      serviceKey: settings.serviceKey,
      fetch: runtimeFetch,
      vision: provider(ai.visionModel),
    }),
    embedding: createEmbeddingHandler(duplicates),
    duplicate_match: createDuplicateMatchHandler(duplicates),
    coordination: createCoordinationHandler({ rpc, provider: provider(ai.coordinatorModel) }),
  });
}

const handlers = configured.ok ? handlersFor(configured.settings) : undefined;

runtime.serve((request) => {
  if (!configured.ok || handlers === undefined) {
    return Response.json({ error: "WORKER_NOT_CONFIGURED" }, { status: 503 });
  }
  const { settings } = configured;
  return handleWorkerRequest(request, settings, {
    db: createRestWorkerDatabase({
      supabaseUrl: settings.supabaseUrl,
      serviceKey: settings.serviceKey,
      fetch: runtimeFetch,
    }),
    handlers,
    log,
  });
});
