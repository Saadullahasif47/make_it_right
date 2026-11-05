import "server-only";

import { Copy, Layers } from "lucide-react";
import Link from "next/link";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

import { getSharedCase, listMatchCandidates, type MatchCandidate } from "../repository";

import { CandidateDecision, KeepSeparate } from "./candidate-forms";

interface DuplicatesPanelProps {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
  readonly viewer: "admin" | "staff";
  /** Where another report's page is for this viewer. */
  readonly hrefFor: (complaintId: string) => string;
}

const DECISION_LABELS: Readonly<Record<MatchCandidate["decision"], string>> = {
  pending: "Waiting for a decision",
  accepted: "Linked",
  rejected: "Different problem",
  superseded: "Not needed (linked elsewhere)",
};

function Evidence({ candidate }: { readonly candidate: MatchCandidate }) {
  const chips = [
    candidate.sameRoom ? "Same room" : candidate.sameBuilding ? "Same building" : null,
    candidate.categoryMatch ? "Category compatible" : null,
    candidate.sameAsset ? "Same equipment" : null,
  ].filter((chip): chip is string => chip !== null);
  return (
    <ul aria-label="Why it was suggested" className="flex flex-wrap gap-1.5 text-xs">
      <li className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-ink-muted">
        Wording {Math.round(candidate.similarity * 100)}% similar
      </li>
      {chips.map((chip) => (
        <li
          key={chip}
          className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-ink-muted"
        >
          {chip}
        </li>
      ))}
      <li className="rounded-md border border-line px-2 py-0.5 font-mono text-ink-subtle">
        score {candidate.score.toFixed(2)}
      </li>
    </ul>
  );
}

/**
 * Shared cases and duplicate candidates on a ticket page (plan v2 F2.04). Candidates are
 * suggestions for an administrator to accept or reject; every report stays its own page.
 */
export async function DuplicatesPanel({
  client,
  complaintId,
  viewer,
  hrefFor,
}: DuplicatesPanelProps) {
  const [shared, candidates] = await Promise.all([
    getSharedCase(client, complaintId),
    viewer === "admin" ? listMatchCandidates(client, complaintId) : Promise.resolve([]),
  ]);
  const pending = candidates.filter((candidate) => candidate.decision === "pending");
  if (shared === null && candidates.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="duplicates-title"
      className="@container space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="duplicates-title" className="text-lg font-semibold text-ink">
        {shared === null ? "Possible duplicates" : "Shared case"}
      </h2>

      {shared === null ? null : (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Layers aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <span>
              Case <span className="font-mono font-semibold">{shared.reference}</span> brings
              together {shared.reports.length} reports of the same problem. Each report keeps its
              own page and reporter.
            </span>
          </p>
          <ul className="space-y-1 text-sm">
            {shared.reports.map((report) => (
              <li key={report.id}>
                {report.id === complaintId ? (
                  <span className="text-ink-muted">
                    <span className="font-mono">{report.reference}</span> {report.title} (this
                    report)
                  </span>
                ) : (
                  <Link
                    href={hrefFor(report.id)}
                    className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    <span className="font-mono">{report.reference}</span> {report.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.length === 0 ? null : (
        <div className="space-y-3">
          {shared === null ? (
            <p className="text-sm text-ink-muted">
              These open cases may describe the same problem. They are suggestions ranked by similar
              wording and place, not facts: link a report only when you are sure.
            </p>
          ) : null}
          <ul className="space-y-3">
            {candidates.map((candidate) => (
              <li
                key={candidate.id}
                className={cn(
                  "space-y-2 rounded-lg border p-4",
                  candidate.decision === "pending"
                    ? "border-line-strong"
                    : "border-line bg-surface-muted",
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Copy aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
                  <span className="font-mono font-semibold text-ink">
                    {candidate.candidate?.reference ?? "Another department's case"}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {DECISION_LABELS[candidate.decision]}
                  </span>
                </div>
                {candidate.candidate === null ? null : (
                  <div className="space-y-1 text-sm text-ink-muted">
                    <p>
                      {candidate.candidate.location ?? "Location not matched"}
                      {candidate.candidate.department === null
                        ? ""
                        : ` · ${candidate.candidate.department}`}
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {candidate.candidate.reports.slice(0, 3).map((report) => (
                        <li key={report.id}>
                          <span className="font-mono">{report.reference}</span> {report.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Evidence candidate={candidate} />
                {candidate.decision === "pending" &&
                candidate.candidate !== null &&
                shared === null ? (
                  <CandidateDecision
                    complaintId={complaintId}
                    candidateId={candidate.id}
                    expectedVersion={candidate.candidate.version}
                    caseReference={candidate.candidate.reference}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {pending.length > 0 && shared === null ? (
            <KeepSeparate complaintId={complaintId} />
          ) : null}
        </div>
      )}
    </section>
  );
}
