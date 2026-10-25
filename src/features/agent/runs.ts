import "server-only";

import { z } from "zod";

import type { ComplaintCategoryValue } from "@/features/complaints/repository";
import type { TicketPriority } from "@/features/complaints/statuses";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { isRunRecordCode, type RunRecordCode } from "./failures";

export type RunOutcome = "running" | "routed" | "needs_review" | "superseded";

/** The stored trace, parsed defensively: it is rendered, so it is never trusted blindly. */
const traceSchema = z.array(
  z.object({
    step: z.number().int(),
    tool: z.string().max(64),
    verdict: z.enum(["ok", "rejected", "accepted", "review"]),
    code: z.string().max(40).optional(),
    category: z.string().max(40).optional(),
    departmentId: z.string().max(64).optional(),
    priority: z.string().max(20).optional(),
  }),
);

export type RunTraceEntry = z.infer<typeof traceSchema>[number];

export interface AgentRunView {
  readonly id: string;
  readonly trigger: "submission" | "admin_retry";
  readonly outcome: RunOutcome;
  readonly failureCode: RunRecordCode | null;
  readonly model: string;
  readonly promptVersion: string;
  readonly durationMs: number | null;
  readonly startedAt: string;
  readonly proposal: {
    readonly category: ComplaintCategoryValue | null;
    readonly departmentId: string | null;
    readonly priority: TicketPriority | null;
  };
  readonly trace: readonly RunTraceEntry[];
}

/** The AI attempts on one ticket, newest first. RLS limits this to administrators. */
export async function listAgentRuns(
  client: AppSupabaseClient,
  ticketId: string,
): Promise<readonly AgentRunView[]> {
  const { data, error } = await client
    .from("agent_runs")
    .select(
      "id, trigger, outcome, failure_code, model, prompt_version, duration_ms, started_at, proposed_category, proposed_department_id, proposed_priority, tool_calls",
    )
    .eq("complaint_id", ticketId)
    .order("started_at", { ascending: false })
    .limit(5);
  if (error !== null) {
    throw new Error("agent runs unavailable", { cause: error });
  }
  return data.map((row) => {
    const trace = traceSchema.safeParse(row.tool_calls);
    return {
      id: row.id,
      trigger: row.trigger,
      outcome: row.outcome,
      failureCode:
        row.failure_code !== null && isRunRecordCode(row.failure_code) ? row.failure_code : null,
      model: row.model,
      promptVersion: row.prompt_version,
      durationMs: row.duration_ms,
      startedAt: row.started_at,
      proposal: {
        category: row.proposed_category,
        departmentId: row.proposed_department_id,
        priority: row.proposed_priority,
      },
      trace: trace.success ? trace.data : [],
    };
  });
}

/** The number of attempts agent_begin_run allows per ticket. */
export const MAX_RUNS_PER_TICKET = 3;
