import { Cpu } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { LocalTime } from "@/components/ui/local-time";
import { Notice } from "@/components/ui/notice";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { RetryJobForm } from "@/features/background-jobs/components/retry-job-form";
import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  errorLabel,
  type AiJobStatus,
} from "@/features/background-jobs/labels";
import {
  JOB_LIST_LIMIT,
  countAiJobsByStatus,
  listAiJobs,
} from "@/features/background-jobs/repository";
import { aiJobsPanelEnabled } from "@/features/background-jobs/visibility";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "AI jobs" };

function parseStatus(raw: string | string[] | undefined): AiJobStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return JOB_STATUSES.find((status) => status === value);
}

const STATUS_TONES: Readonly<Record<AiJobStatus, string>> = {
  queued: "bg-info-soft text-info-ink",
  running: "bg-info-soft text-info-ink",
  retry_wait: "bg-accent-soft text-accent-ink",
  needs_review: "bg-danger-soft text-danger",
  succeeded: "bg-success-soft text-success",
};

async function AiJobs({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/jobs">["searchParams"];
}) {
  const access = await requirePageAccess(["admin"], "/admin/jobs");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }
  if (!aiJobsPanelEnabled()) {
    notFound();
  }

  const query = await searchParams;
  const status = parseStatus(query.status);
  const retried = query.notice === "retried";
  const client = await createSupabaseServerClient();
  const [jobs, counts] = await Promise.all([
    listAiJobs(client, status),
    countAiJobsByStatus(client),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI jobs"
        description="Background AI work, such as photo analysis. Every report is saved before its job is queued, so a failed job never loses a report. A job is tried up to three times, then waits here for review."
      />

      {retried ? (
        <Notice tone="success">Job queued again. The worker picks it up within a minute.</Notice>
      ) : null}

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[undefined, ...JOB_STATUSES].map((value) => {
          const active = value === status;
          const label = value === undefined ? "All" : JOB_STATUS_LABELS[value];
          return (
            <Link
              key={value ?? "all"}
              href={value === undefined ? "/admin/jobs" : `/admin/jobs?status=${value}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                active
                  ? "border-brand bg-brand-soft text-ink"
                  : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {label}
              {value === undefined ? null : (
                <span
                  className={cn(
                    "font-mono text-xs",
                    // The tinted active chip needs the darker text to keep 4.5:1 contrast.
                    active ? "text-ink-muted" : "text-ink-subtle",
                  )}
                >
                  {counts[value]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {jobs.length === 0 ? (
        <EmptyState icon={Cpu} title={status === undefined ? "No AI jobs yet" : "Nothing here"}>
          {status === undefined
            ? "Jobs appear here when a feature queues AI work, for example when a photo is added to a report."
            : "No job has this status right now."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface" tabIndex={0}>
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">AI jobs, newest first (up to {JOB_LIST_LIMIT})</caption>
            <thead className="border-b border-line text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Job
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Attempts
                </th>
                <th scope="col" className="px-4 py-3">
                  Last problem
                </th>
                <th scope="col" className="px-4 py-3">
                  Updated
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((job) => (
                <tr key={job.id} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{JOB_TYPE_LABELS[job.jobType]}</span>
                    <span className="block font-mono text-xs text-ink-subtle">
                      {job.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                        STATUS_TONES[job.status],
                      )}
                    >
                      {JOB_STATUS_LABELS[job.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-ink-muted">
                    {job.attempts} / 3
                    {job.adminRetries === 0 ? null : (
                      <span className="block text-xs">retried {job.adminRetries}×</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {errorLabel(job.lastErrorCode) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    <LocalTime value={job.updatedAt} />
                  </td>
                  <td className="px-4 py-3">
                    {job.status === "needs_review" && job.adminRetries < 3 ? (
                      <RetryJobForm jobId={job.id} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AiJobsPage({ searchParams }: PageProps<"/admin/jobs">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AiJobs searchParams={searchParams} />
    </Suspense>
  );
}
