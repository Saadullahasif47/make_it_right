import { LoaderCircle, ScanEye, TriangleAlert, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import {
  DECISION_LABELS,
  FLAG_LABELS,
  RETAKE_FLAGS,
  SEVERITY_LABELS,
  categoryLabel,
} from "../labels";
import type { PhotoAnalysis } from "../repository";

import { ReviewForm } from "./review-form";

export type AnalysisViewer = "reporter" | "staff" | "admin";

interface AnalysisCardProps {
  readonly complaintId: string;
  readonly photo: PhotoAnalysis;
  readonly viewer: AnalysisViewer;
  /** The reporter may respond only while the ticket is open. */
  readonly canRespond: boolean;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-0.5 @xl:grid-cols-[9rem_minmax(0,1fr)] @xl:gap-3">
      <dt className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * What the AI saw in one photo (plan v2 F1): observations kept apart from the possible issue,
 * what the photo cannot show, and every reason a person should check. Always labelled as a
 * suggestion; never as a finding.
 */
export function AnalysisCard({ complaintId, photo, viewer, canRespond }: AnalysisCardProps) {
  if (photo.state === "analysing") {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
        AI observation in progress. You can leave this page; the result is saved.
      </p>
    );
  }
  if (photo.state === "with_staff" || photo.analysis === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <UserRound aria-hidden="true" className="size-4" />
        The AI could not analyse this photo. Staff will look at it themselves.
      </p>
    );
  }

  const { analysis, latestReview } = photo;
  const retake = analysis.uncertaintyFlags.some((flag) => RETAKE_FLAGS.has(flag));
  const showReview = viewer === "admin" || (viewer === "reporter" && canRespond);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ScanEye aria-hidden="true" className="size-4 text-brand" />
          AI observation
        </span>
        <span className="text-xs text-ink-subtle">
          A suggestion, not a finding. It may be wrong.
        </span>
        {analysis.needsHumanReview ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            Needs a person to check
          </span>
        ) : null}
      </div>

      <dl className="space-y-2">
        <Row label="Visible">
          <ul className="list-disc space-y-0.5 pl-4">
            {analysis.visibleObservations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Row>
        <Row label="Possible issue">{analysis.possibleIssue}</Row>
        <Row label="Suggested category">{categoryLabel(analysis.suggestedCategory)}</Row>
        <Row label="Severity hint">
          {SEVERITY_LABELS[analysis.severityHint] ?? analysis.severityHint}
        </Row>
        {analysis.notVisibleOrUncertain.length === 0 ? null : (
          <Row label="Not visible">
            <ul className="list-disc space-y-0.5 pl-4">
              {analysis.notVisibleOrUncertain.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Row>
        )}
        <Row label="Why">{analysis.explanation}</Row>
      </dl>

      {analysis.uncertaintyFlags.length === 0 ? null : (
        <ul aria-label="Reasons to check" className="flex flex-wrap gap-1.5">
          {analysis.uncertaintyFlags.map((flag) => (
            <li
              key={flag}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs",
                flag === "HIGH_SEVERITY" || flag === "TEXT_IMAGE_MISMATCH"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : "border-line bg-surface-muted text-ink-muted",
              )}
            >
              {FLAG_LABELS[flag] ?? flag}
            </li>
          ))}
        </ul>
      )}

      {retake && viewer === "reporter" ? (
        <p className="text-sm text-ink-muted">
          A clearer, well-lit photo of the problem would help. You can add another one above.
        </p>
      ) : null}

      {latestReview === null ? null : (
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{DECISION_LABELS[latestReview.decision]}</span>{" "}
          by {latestReview.reviewerRole === "admin" ? "an administrator" : "the reporter"}
          {latestReview.correctedCategory === null
            ? ""
            : `: category ${categoryLabel(latestReview.correctedCategory)}`}
          {latestReview.note === null ? "" : ` (“${latestReview.note}”)`}
        </p>
      )}

      <p className="font-mono text-xs text-ink-subtle">
        {analysis.model} · {analysis.promptVersion}
      </p>

      {showReview ? (
        <ReviewForm
          complaintId={complaintId}
          analysisId={analysis.id}
          canCorrect={viewer === "admin"}
        />
      ) : null}
    </div>
  );
}
