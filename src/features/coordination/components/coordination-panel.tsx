import "server-only";

import {
  Ban,
  Check,
  ClipboardList,
  Hourglass,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";

import { LocalTime } from "@/components/ui/local-time";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

import {
  OUTCOME_LABELS,
  SOURCE_LABELS,
  UNAUTHORISED_VERDICTS,
  VERDICT_LABELS,
  categoryLabel,
  priorityLabel,
  reasonLabel,
  toolLabel,
} from "../labels";
import { loadCoordination, type CoordinationRun, type TraceStep } from "../repository";

import { ProposalDecision, RequestCoordination } from "./coordination-forms";

interface CoordinationPanelProps {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
  readonly viewer: "admin" | "staff";
  /** Department names by id, to make the trace readable. */
  readonly departments?: ReadonlyMap<string, string>;
}

const OPEN_STATES = new Set(["open", "needs_review", "assigned", "in_progress", "reopened"]);

function verdictIcon(verdict: string): { icon: LucideIcon; className: string } {
  if (
    UNAUTHORISED_VERDICTS.has(verdict) ||
    verdict === "policy_rejected" ||
    verdict === "invalid_args"
  ) {
    return { icon: Ban, className: "text-danger" };
  }
  if (verdict === "review") return { icon: UserRoundSearch, className: "text-accent-ink" };
  return { icon: Check, className: "text-ink-muted" };
}

/** Arguments as words: department ids become names, other ids are shortened. */
function describeArgs(step: TraceStep, departments: ReadonlyMap<string, string>): string {
  return Object.entries(step.args)
    .filter(([key]) => key !== "case_id")
    .map(([key, value]) => {
      if (key === "department_id") return departments.get(value) ?? "a department";
      if (key === "category") return categoryLabel(value);
      if (key === "priority") return `${priorityLabel(value).toLowerCase()} priority`;
      if (key === "reason_code") return reasonLabel(`MODEL_${value}`);
      return `${key.replace(/_id$/, "")} ${value.slice(0, 8)}`;
    })
    .join(", ");
}

function Trace({
  run,
  departments,
}: {
  readonly run: CoordinationRun;
  readonly departments: ReadonlyMap<string, string>;
}) {
  const refused = run.trace.filter((step) => UNAUTHORISED_VERDICTS.has(step.verdict)).length;
  return (
    <details className="group rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm text-ink">
        <span className="font-medium">{OUTCOME_LABELS[run.outcome] ?? run.outcome}</span>
        <span className="text-ink-muted">
          {" "}
          · <LocalTime value={run.createdAt} /> · {run.trace.length} steps
          {run.durationMs === null ? "" : ` · ${(run.durationMs / 1000).toFixed(1)} s`}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {run.reasonCode === null ? null : (
          <p className="text-sm text-ink-muted">Why: {reasonLabel(run.reasonCode)}</p>
        )}
        {refused > 0 ? (
          <p className="text-sm text-danger">
            {refused === 1
              ? "1 request for something outside its tools or this case was refused."
              : `${String(refused)} requests for things outside its tools or this case were refused.`}
          </p>
        ) : null}
        <ol aria-label="Tool calls" className="space-y-1.5">
          {run.trace.map((step) => {
            const { icon: Icon, className } = verdictIcon(step.verdict);
            const details = describeArgs(step, departments);
            return (
              <li key={step.step} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-ink-subtle">
                  {step.step}
                </span>
                <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", className)} />
                <span className="min-w-0">
                  {toolLabel(step.tool)}
                  {details === "" ? "" : ` (${details})`}:{" "}
                  <span className={className}>{VERDICT_LABELS[step.verdict] ?? step.verdict}</span>
                  <span className="text-xs text-ink-subtle"> {step.ms} ms</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="font-mono text-xs text-ink-subtle">
          {run.model} · {run.promptVersion}
        </p>
      </div>
    </details>
  );
}

/**
 * The maintenance coordinator on a ticket page (plan v2 F3.04-F3.05): the case's active work
 * order, a proposal waiting for approval with the policy's reasons, and a readable trace of every
 * tool the model asked for. Departments see the work order and may ask for a fresh look; only
 * administrators see runs and decide proposals.
 */
export async function CoordinationPanel({
  client,
  complaintId,
  viewer,
  departments = new Map(),
}: CoordinationPanelProps) {
  const view = await loadCoordination(client, complaintId);
  if (view === null) return null;
  const open = OPEN_STATES.has(view.caseStatus);
  const proposal = view.pendingProposal;

  return (
    <section
      aria-labelledby="coordination-title"
      className="@container space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="coordination-title" className="text-lg font-semibold text-ink">
        Work order
      </h2>

      {view.activeWorkOrder === null ? (
        <p className="text-sm text-ink-muted">
          Case <span className="font-mono">{view.caseReference}</span> has no active work order yet.
        </p>
      ) : (
        <p className="flex items-start gap-2 text-sm text-ink">
          <ClipboardList aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="font-semibold">{view.activeWorkOrder.department}</span> holds the work
            order for case <span className="font-mono">{view.caseReference}</span>,{" "}
            {SOURCE_LABELS[view.activeWorkOrder.source] ?? view.activeWorkOrder.source} on{" "}
            <LocalTime value={view.activeWorkOrder.assignedAt} />.
          </span>
        </p>
      )}

      {viewer === "admin" && proposal !== null ? (
        <div className="space-y-3 rounded-lg border border-line-strong p-4">
          <p className="text-sm font-semibold text-ink">Proposal waiting for your approval</p>
          <dl className="grid gap-x-4 gap-y-1 text-sm @lg:grid-cols-[auto_1fr]">
            <dt className="text-ink-muted">Department</dt>
            <dd className="text-ink">{proposal.department}</dd>
            <dt className="text-ink-muted">Category</dt>
            <dd className="text-ink">{categoryLabel(proposal.category)}</dd>
            <dt className="text-ink-muted">Priority</dt>
            <dd className="text-ink">{priorityLabel(proposal.priority)}</dd>
            <dt className="text-ink-muted">Reason given</dt>
            <dd className="text-ink">{proposal.rationale}</dd>
          </dl>
          <div className="space-y-1">
            <p className="text-sm text-ink-muted">Why a person must approve it:</p>
            <ul aria-label="Approval reasons" className="flex flex-wrap gap-1.5 text-xs">
              {proposal.policyReasons.map((reason) => (
                <li
                  key={reason}
                  className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-ink-muted"
                >
                  {reasonLabel(reason)}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-ink-muted">
            The coordinator only proposes. Nothing changes until you approve; rejecting leaves the
            case for you to route by hand.
          </p>
          <ProposalDecision
            complaintId={complaintId}
            proposalId={proposal.id}
            expectedVersion={view.caseVersion}
          />
        </div>
      ) : null}

      {viewer === "admin" && view.jobPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Hourglass aria-hidden="true" className="size-4 shrink-0" />
          The coordinator is working on this case. Refresh in a moment.
        </p>
      ) : null}

      {viewer === "admin" && view.runs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Coordinator runs</h3>
          {view.runs.map((run) => (
            <Trace key={run.id} run={run} departments={departments} />
          ))}
        </div>
      ) : null}

      {open && !view.jobPending && proposal === null ? (
        <RequestCoordination
          complaintId={complaintId}
          caseId={view.caseId}
          again={view.runs.length > 0}
        />
      ) : null}
    </section>
  );
}
