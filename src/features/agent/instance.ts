import "server-only";

import type { TicketState } from "@/features/complaints/statuses";
import { getServerConfig } from "@/lib/config";
import type { Logger } from "@/lib/logging/logger";
import { getPrivilegedSupabaseClient } from "@/lib/supabase/privileged";

import { createGeminiModelClient } from "./gemini";
import type { ModelClient } from "./model";
import { createAgentStore } from "./store";
import { triageTicket, type TriageRequest, type TriageResult } from "./triage";

export type TriageRunner = (request: TriageRequest, logger: Logger) => Promise<TriageResult>;

let cachedModel: ModelClient | undefined;

/**
 * The production wiring of the agent, or undefined while AI_ENABLED is off (tickets then wait
 * for manual routing exactly as in Phase 3). Built per call from the cached config and clients.
 */
export function getTriageRunner(): TriageRunner | undefined {
  const { ai } = getServerConfig();
  if (!ai.enabled) {
    return undefined;
  }
  const client = getPrivilegedSupabaseClient();
  if (client === null) {
    // Without the privileged adapter nothing can be recorded: tickets stay "submitted" and
    // appear in the review queue. This is a deployment error, so it is logged loudly.
    return (request, logger) => {
      logger.error("agent.adapter_not_configured", { complaintId: request.ticketId });
      return Promise.resolve({ ok: false, code: "UNAVAILABLE" });
    };
  }
  if (ai.apiKey !== undefined) {
    cachedModel ??= createGeminiModelClient({
      apiKey: ai.apiKey,
      model: ai.model,
      baseUrl: ai.baseUrl,
    });
  }
  const deps = {
    store: createAgentStore(client),
    model: ai.apiKey === undefined ? undefined : cachedModel,
    modelName: ai.model,
    timeoutMs: ai.timeoutMs,
  };
  return (request, logger) => triageTicket({ ...deps, logger }, request);
}

/**
 * The best-effort step that runs after a student's ticket is durably created (plan §4). It
 * resolves to the ticket's status afterwards, or undefined when nothing changed.
 */
export function submissionTriage(
  actorId: string,
  logger: Logger,
): ((ticketId: string) => Promise<TicketState | undefined>) | undefined {
  const run = getTriageRunner();
  if (run === undefined) {
    return undefined;
  }
  return async (ticketId) => {
    const result = await run({ ticketId, trigger: "submission", requestedBy: actorId }, logger);
    return result.ok ? result.status : undefined;
  };
}
