import "server-only";

import { z } from "zod";

import type { AppSupabaseClient } from "@/lib/supabase/server";

export interface TraceStep {
  readonly step: number;
  readonly tool: string;
  readonly args: Readonly<Record<string, string>>;
  readonly verdict: string;
  readonly ms: number;
}

const traceSchema = z.array(
  z.object({
    step: z.number(),
    tool: z.string(),
    args: z.record(z.string(), z.string()),
    verdict: z.string(),
    ms: z.number(),
  }),
);

export interface CoordinationRun {
  readonly id: string;
  readonly outcome: string;
  readonly reasonCode: string | null;
  readonly model: string;
  readonly promptVersion: string;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly trace: readonly TraceStep[];
}

export interface Proposal {
  readonly id: string;
  readonly department: string;
  readonly category: string;
  readonly priority: string;
  readonly rationale: string;
  readonly policyReasons: readonly string[];
  readonly expectedCaseVersion: number;
  readonly status: string;
  readonly runId: string;
}

export interface WorkOrder {
  readonly department: string;
  readonly source: string;
  readonly assignedAt: string;
}

export interface CoordinationView {
  readonly caseId: string;
  readonly caseReference: string;
  readonly caseStatus: string;
  readonly caseVersion: number;
  readonly activeWorkOrder: WorkOrder | null;
  readonly pendingProposal: Proposal | null;
  readonly runs: readonly CoordinationRun[];
  readonly jobPending: boolean;
}

function check<T>(result: { data: T; error: { code?: string } | null }, what: string): T {
  if (result.error !== null) {
    throw new Error(`${what} failed: ${result.error.code ?? "unknown"}`);
  }
  return result.data;
}

/** Everything the admin needs to see about one report's case and its coordinator runs. */
export async function loadCoordination(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<CoordinationView | null> {
  const link = check(
    await client
      .from("case_reports")
      .select("case:maintenance_cases!case_reports_case_id_fkey(id, reference_no, status, version)")
      .eq("complaint_id", complaintId)
      .maybeSingle(),
    "case lookup",
  );
  const caseRow = (
    link as unknown as {
      case: { id: string; reference_no: number; status: string; version: number } | null;
    } | null
  )?.case;
  if (caseRow === undefined || caseRow === null) return null;

  const [workOrders, proposals, runs, jobs] = await Promise.all([
    client
      .from("case_work_orders")
      .select("source, assigned_at, department:departments(name)")
      .eq("case_id", caseRow.id)
      .eq("status", "active"),
    client
      .from("work_order_proposals")
      .select(
        "id, category, priority, rationale, policy_reasons, expected_case_version, status, run_id, department:departments(name)",
      )
      .eq("case_id", caseRow.id)
      .eq("status", "pending"),
    client
      .from("coordination_runs")
      .select(
        "id, outcome, reason_code, model, prompt_version, duration_ms, created_at, tool_trace",
      )
      .eq("case_id", caseRow.id)
      .order("created_at", { ascending: false })
      .limit(3),
    client
      .from("ai_jobs")
      .select("id")
      .eq("job_type", "coordination")
      .eq("target_id", caseRow.id)
      .in("status", ["queued", "running", "retry_wait"]),
  ]);

  const activeRows = check(workOrders, "work order lookup") as unknown as readonly {
    source: string;
    assigned_at: string;
    department: { name: string } | null;
  }[];
  const pendingRows = check(proposals, "proposal lookup") as unknown as readonly {
    id: string;
    category: string;
    priority: string;
    rationale: string;
    policy_reasons: string[];
    expected_case_version: number;
    status: string;
    run_id: string;
    department: { name: string } | null;
  }[];
  const runRows = check(runs, "run lookup") ?? [];
  const jobRows = check(jobs, "job lookup") ?? [];

  const active = activeRows[0];
  const pending = pendingRows[0];
  return {
    caseId: caseRow.id,
    caseReference: `MC-${String(caseRow.reference_no)}`,
    caseStatus: caseRow.status,
    caseVersion: caseRow.version,
    activeWorkOrder:
      active === undefined
        ? null
        : {
            department: active.department?.name ?? "Unknown",
            source: active.source,
            assignedAt: active.assigned_at,
          },
    pendingProposal:
      pending === undefined
        ? null
        : {
            id: pending.id,
            department: pending.department?.name ?? "Unknown",
            category: pending.category,
            priority: pending.priority,
            rationale: pending.rationale,
            policyReasons: pending.policy_reasons,
            expectedCaseVersion: pending.expected_case_version,
            status: pending.status,
            runId: pending.run_id,
          },
    runs: runRows.map((run) => ({
      id: run.id,
      outcome: run.outcome,
      reasonCode: run.reason_code,
      model: run.model,
      promptVersion: run.prompt_version,
      durationMs: run.duration_ms,
      createdAt: run.created_at,
      trace: traceSchema.catch([]).parse(run.tool_trace),
    })),
    jobPending: jobRows.length > 0,
  };
}

export interface PendingProposalSummary {
  readonly id: string;
  readonly caseReference: string;
  readonly department: string;
  readonly priority: string;
  readonly policyReasons: readonly string[];
  readonly createdAt: string;
  /** A report of the case, whose admin page holds the approval panel. */
  readonly complaintId: string | null;
  readonly title: string | null;
}

/** Proposals waiting for an administrator (A4.03 review queue), oldest first. */
export async function listPendingProposals(
  client: AppSupabaseClient,
): Promise<readonly PendingProposalSummary[]> {
  const rows = check(
    await client
      .from("work_order_proposals")
      .select(
        "id, priority, policy_reasons, created_at, department:departments(name), case:maintenance_cases!work_order_proposals_case_id_fkey(reference_no, reports:case_reports(complaint:complaints(id, title)))",
      )
      .eq("status", "pending")
      .order("created_at")
      .limit(20),
    "pending proposals",
  ) as unknown as readonly {
    id: string;
    priority: string;
    policy_reasons: string[];
    created_at: string;
    department: { name: string } | null;
    case: {
      reference_no: number;
      reports: { complaint: { id: string; title: string } | null }[];
    } | null;
  }[];
  return rows.map((row) => {
    const report = row.case?.reports.find((entry) => entry.complaint !== null)?.complaint ?? null;
    return {
      id: row.id,
      caseReference: row.case === null ? "MC-?" : `MC-${String(row.case.reference_no)}`,
      department: row.department?.name ?? "Unknown",
      priority: row.priority,
      policyReasons: row.policy_reasons,
      createdAt: row.created_at,
      complaintId: report?.id ?? null,
      title: report?.title ?? null,
    };
  });
}
