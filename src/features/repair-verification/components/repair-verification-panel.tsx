import "server-only";

import { ShieldCheck } from "lucide-react";
import Image from "next/image";

import { LocalTime } from "@/components/ui/local-time";
import { PhotoUploader } from "@/features/evidence/components/photo-uploader";
import { PendingRefresh } from "@/features/visual-inspection/components/pending-refresh";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

import { AI_STATUS_LABELS, KIND_LABELS, STATE_LABELS, flagLabel } from "../labels";
import { loadRepairVerification, type VerificationReview } from "../service";

interface RepairVerificationPanelProps {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
  /** Staff add photos; reporters see them and decide through "Is it fixed?". */
  readonly viewer: "staff" | "reporter";
}

function Thumb({
  url,
  alt,
  missing,
}: {
  readonly url: string | null;
  readonly alt: string;
  readonly missing: string;
}) {
  return (
    <div className="aspect-square w-full overflow-hidden rounded-lg border border-line bg-surface-muted">
      {url === null ? (
        <span className="flex size-full items-center justify-center p-2 text-center text-xs text-ink-muted">
          {missing}
        </span>
      ) : (
        <Image
          src={url}
          alt={alt}
          width={320}
          height={320}
          unoptimized
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

function List({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Review({ review }: { readonly review: VerificationReview }) {
  const status = review.aiStatus === null ? null : AI_STATUS_LABELS[review.aiStatus];
  return (
    <article aria-label="Photo comparison" className="space-y-3 rounded-lg border border-line p-4">
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1">
          <Thumb
            url={review.beforeUrl}
            alt="Before the repair"
            missing={
              review.beforeSource === null
                ? "No before photo"
                : "Before photo from another report (not shown)"
            }
          />
          <figcaption className="text-xs text-ink-muted">
            Before{review.beforeSource === "report" ? " (from the report)" : ""}
          </figcaption>
        </figure>
        <figure className="space-y-1">
          <Thumb url={review.afterUrl} alt="After the repair" missing="Photo unavailable" />
          <figcaption className="text-xs text-ink-muted">After</figcaption>
        </figure>
      </div>

      <p className="text-sm text-ink-muted">
        {STATE_LABELS[review.state]}
        {review.decidedAt === null ? null : (
          <>
            {" "}
            · <LocalTime value={review.decidedAt} />
          </>
        )}
      </p>
      {review.decisionNote === null ? null : (
        <p className="text-sm text-ink">&ldquo;{review.decisionNote}&rdquo;</p>
      )}

      {status === null ? null : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", status.tone)}>
              AI suggestion: {status.label}
            </span>
            <span className="text-ink-muted">{status.meaning}</span>
          </p>
          {review.explanation === null ? null : (
            <p className="text-sm text-ink">{review.explanation}</p>
          )}
          <List title="Before" items={review.beforeObservations} />
          <List title="After" items={review.afterObservations} />
          <List title="Visible changes" items={review.visibleChanges} />
          <List title="Cannot be seen" items={review.notVisible} />
          {review.flags.length === 0 ? null : (
            <ul aria-label="Why to be careful" className="flex flex-wrap gap-1.5 text-xs">
              {review.flags.map((flag) => (
                <li
                  key={flag}
                  className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-ink-muted"
                >
                  {flagLabel(flag)}
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono text-xs text-ink-subtle">
            {review.model ?? "no model"} · {review.promptVersion ?? "-"} · no functional test
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * Before/after repair evidence of a report's case (plan v2 F4.04). The AI comparison is a
 * suggestion: it says what looks different, never that the repair works, and only a person's
 * confirmation closes the case.
 */
export async function RepairVerificationPanel({
  client,
  complaintId,
  viewer,
}: RepairVerificationPanelProps) {
  const view = await loadRepairVerification(client, complaintId);
  if (view === null) return null;
  const latest = view.reviews[0];
  const open =
    latest !== undefined && (latest.state === "pending" || latest.state === "awaiting_decision");
  const canUpload = viewer === "staff" && view.canUpload;
  if (view.photos.length === 0 && view.reviews.length === 0 && !canUpload) return null;
  const endpoint = `/api/cases/${view.caseId}/repair-evidence`;

  return (
    <section
      aria-labelledby="repair-title"
      className="@container space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="repair-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-brand" />
        Repair verification
      </h2>
      <p className="text-sm text-ink-muted">
        Photos of case <span className="font-mono">{view.reference}</span> before and after the
        repair. An AI comparison suggests whether the visible problem looks reduced; a photo cannot
        show that it works, so only a person can close the case.
      </p>

      {latest === undefined ? null : <Review review={latest} />}

      {viewer === "reporter" && latest?.state === "awaiting_decision" ? (
        <p className="text-sm text-ink">
          Check the photos, then answer &ldquo;Is it fixed?&rdquo; on this page.
        </p>
      ) : null}

      {view.photos.length === 0 ? null : (
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm text-ink">
            All repair photos ({view.photos.length})
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-3 @lg:grid-cols-3">
            {view.photos.map((photo, index) => (
              <li key={photo.id} className="space-y-1">
                <Thumb
                  url={photo.url}
                  alt={`${KIND_LABELS[photo.kind]} photo ${String(index + 1)}`}
                  missing="Photo unavailable"
                />
                <p className="text-xs text-ink-muted">
                  {KIND_LABELS[photo.kind]} · <LocalTime value={photo.addedAt} />
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canUpload && open ? (
        <p className="border-t border-line pt-4 text-sm text-ink-muted">
          The after photo is waiting for a decision. More photos can be added if the repair is sent
          back.
        </p>
      ) : null}
      {canUpload && !open ? (
        <div className="space-y-4 border-t border-line pt-4">
          <PhotoUploader
            endpoint={endpoint}
            fields={{ kind: "before" }}
            label="Add a before photo"
            hint="Before starting work. JPEG, PNG or WebP, up to 2 MB."
            doneMessage="Before photo added."
          />
          <PhotoUploader
            endpoint={endpoint}
            fields={{ kind: "after" }}
            label="Add an after photo"
            hint="When the repair is done. It is compared with the before photo. Private to the case's staff, reporters and administrators."
            doneMessage="After photo added. The comparison will appear shortly."
          />
        </div>
      ) : null}

      {latest?.state === "pending" ? <PendingRefresh /> : null}
    </section>
  );
}
