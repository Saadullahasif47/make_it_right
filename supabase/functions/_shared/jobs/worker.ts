import { createJobHandlers } from "./handlers.ts";
import { DEFAULT_BATCH, runBatch, type JobReport } from "./run-batch.ts";
import { JobError, type JobHandler, type JobHandlers } from "./types.ts";
import type { WorkerDatabase } from "./worker-db.ts";

/** Committed in supabase/config.toml for the local Docker stack; refused anywhere else. */
export const LOCAL_WORKER_SECRET = "local-only-ai-worker-secret-0123456789abcdef";

export const WORKER_SECRET_HEADER = "x-worker-secret";

export interface WorkerAiSettings {
  /** AI_ENABLED=true; the worker's own kill switch for provider calls. */
  readonly enabled: boolean;
  readonly apiKey: string | undefined;
  /** GEMINI_VISION_MODEL, else GEMINI_MODEL, else the app's default. */
  readonly visionModel: string;
  /** The local Gemini stub; honoured on the local stack only. */
  readonly baseUrl: string | undefined;
  /** GEMINI_EMBEDDING_MODEL (duplicate detection); vectors of different models never mix. */
  readonly embeddingModel: string;
  /** GEMINI_MODEL, as for triage: the coordinator's tool-calling model. */
  readonly coordinatorModel: string;
}

export interface WorkerSettings {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly secret: string;
  readonly ai: WorkerAiSettings;
  /** Failure simulation for local drills; never on a hosted project. */
  readonly simulationEnabled: boolean;
}

export type SettingsResult =
  | { readonly ok: true; readonly settings: WorkerSettings }
  | { readonly ok: false; readonly problem: string };

const LOCAL_HOSTS = new Set(["kong", "localhost", "127.0.0.1", "host.docker.internal"]);

function isLocalStack(supabaseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
  } catch {
    return false;
  }
}

/** Reads the worker's environment. Problems name the variable, never its value. */
export function readWorkerSettings(env: (name: string) => string | undefined): SettingsResult {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const secret = env("AI_WORKER_SECRET");
  if (supabaseUrl === undefined || serviceKey === undefined || serviceKey === "") {
    return { ok: false, problem: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set" };
  }
  if (secret === undefined || secret.length < 32) {
    return { ok: false, problem: "AI_WORKER_SECRET must be set to at least 32 characters" };
  }
  const local = isLocalStack(supabaseUrl);
  if (secret === LOCAL_WORKER_SECRET && !local) {
    return { ok: false, problem: "AI_WORKER_SECRET is the local development value" };
  }
  const baseUrl = env("GEMINI_BASE_URL");
  if (baseUrl !== undefined && baseUrl !== "" && !local) {
    return { ok: false, problem: "GEMINI_BASE_URL is for the local stack only" };
  }
  const nonEmpty = (name: string): string | undefined => {
    const value = env(name)?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  return {
    ok: true,
    settings: {
      supabaseUrl,
      serviceKey,
      secret,
      ai: {
        enabled: env("AI_ENABLED") === "true",
        apiKey: nonEmpty("GEMINI_API_KEY"),
        visionModel:
          nonEmpty("GEMINI_VISION_MODEL") ?? nonEmpty("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
        baseUrl: nonEmpty("GEMINI_BASE_URL"),
        embeddingModel: nonEmpty("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-2",
        coordinatorModel: nonEmpty("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
      },
      simulationEnabled: local && env("AI_WORKER_FAULTS") === "true",
    },
  };
}

/** Compares in time that depends only on the lengths, not on where the strings differ. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

const SIMULATIONS = ["success", "rate_limited", "provider_unavailable", "crash"] as const;
type Simulation = (typeof SIMULATIONS)[number];

interface DrillOptions {
  readonly simulation: Simulation | undefined;
  readonly retryDelay: number | undefined;
  readonly visibility: number | undefined;
}

function boundedInteger(raw: string | null, min: number, max: number): number | undefined | null {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Drill headers (local only): x-worker-simulate, x-worker-retry-delay, x-worker-visibility. */
function readDrillOptions(headers: Headers): DrillOptions | "invalid" | "none" {
  const rawSimulation = headers.get("x-worker-simulate");
  const retryDelay = boundedInteger(headers.get("x-worker-retry-delay"), 0, 600);
  const visibility = boundedInteger(headers.get("x-worker-visibility"), 1, 600);
  if (rawSimulation === null && retryDelay === undefined && visibility === undefined) {
    return "none";
  }
  const simulation = SIMULATIONS.find((name) => name === rawSimulation);
  if (
    (rawSimulation !== null && simulation === undefined) ||
    retryDelay === null ||
    visibility === null
  ) {
    return "invalid";
  }
  return { simulation, retryDelay, visibility };
}

function simulatedHandlers(simulation: Exclude<Simulation, "crash">): JobHandlers {
  const handler: JobHandler =
    simulation === "success"
      ? () => Promise.resolve()
      : () =>
          Promise.reject(
            new JobError(
              simulation === "rate_limited" ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
              true,
            ),
          );
  return createJobHandlers({
    visual_analysis: handler,
    embedding: handler,
    duplicate_match: handler,
    coordination: handler,
    repair_verify: handler,
    insights_refresh: handler,
  });
}

export interface WorkerDependencies {
  readonly db: WorkerDatabase;
  readonly handlers: JobHandlers;
  readonly log: (event: string, fields: Readonly<Record<string, unknown>>) => void;
  readonly now?: () => number;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function summarise(reports: readonly JobReport[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const report of reports) {
    counts[report.outcome] = (counts[report.outcome] ?? 0) + 1;
  }
  return counts;
}

/** The whole HTTP contract of the worker, free of Deno so it can be tested in Node. */
export async function handleWorkerRequest(
  request: Request,
  settings: WorkerSettings,
  deps: WorkerDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (!secretsMatch(request.headers.get(WORKER_SECRET_HEADER) ?? "", settings.secret)) {
    deps.log("ai_worker.unauthorised", {});
    return json(401, { error: "UNAUTHORISED" });
  }

  const drill = readDrillOptions(request.headers);
  if (drill === "invalid" || (drill !== "none" && !settings.simulationEnabled)) {
    return json(400, { error: drill === "invalid" ? "INVALID_DRILL" : "DRILLS_DISABLED" });
  }
  const options = drill === "none" ? undefined : drill;
  const now = deps.now ?? Date.now;
  const started = now();

  try {
    if (options?.simulation === "crash") {
      // Claims a job and stops without reporting, as a worker that dies mid-job would.
      const claimed = await deps.db.claim(1, options.visibility ?? DEFAULT_BATCH.visibilitySeconds);
      return json(500, { error: "SIMULATED_CRASH", claimed: claimed.length });
    }
    const reports = await runBatch({
      ...DEFAULT_BATCH,
      db: deps.db,
      handlers:
        options?.simulation === undefined ? deps.handlers : simulatedHandlers(options.simulation),
      visibilitySeconds: options?.visibility ?? DEFAULT_BATCH.visibilitySeconds,
      // A drill's short visibility needs a shorter handler limit too.
      jobTimeoutMs:
        options?.visibility === undefined
          ? DEFAULT_BATCH.jobTimeoutMs
          : Math.min(DEFAULT_BATCH.jobTimeoutMs, options.visibility * 1000 - 500),
      retryDelayOverride: options?.retryDelay,
      now,
    });
    deps.log("ai_worker.batch", {
      jobs: reports.length,
      ...summarise(reports),
      durationMs: now() - started,
    });
    return json(200, { processed: reports.length, reports });
  } catch (error) {
    deps.log("ai_worker.failed", {
      error: error instanceof Error ? error.name : "unknown",
      durationMs: now() - started,
    });
    return json(503, { error: "WORKER_UNAVAILABLE" });
  }
}
