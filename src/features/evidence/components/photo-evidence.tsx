import "server-only";

import Image from "next/image";

import {
  AnalysisCard,
  type AnalysisViewer,
} from "@/features/visual-inspection/components/analysis-card";
import { PendingRefresh } from "@/features/visual-inspection/components/pending-refresh";
import { loadPhotoAnalyses } from "@/features/visual-inspection/repository";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { MAX_PHOTOS_PER_COMPLAINT } from "../image";
import { listPhotos } from "../service";

import { PhotoUploader } from "./photo-uploader";

interface PhotoEvidenceProps {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
  readonly viewer: AnalysisViewer;
  /** The reporter may add photos and respond to analyses while the ticket is open. */
  readonly open: boolean;
}

/**
 * The private photos on a report (plan v2 F1), shown through short-lived signed URLs, each with
 * its AI observation. Reporters, the assigned department and administrators see the same
 * photos; only the reporter adds them.
 */
export async function PhotoEvidence({ client, complaintId, viewer, open }: PhotoEvidenceProps) {
  const [photos, analyses] = await Promise.all([
    listPhotos(client, complaintId),
    loadPhotoAnalyses(client, complaintId),
  ]);
  const analysisFor = new Map(analyses.map((entry) => [entry.attachmentId, entry]));
  const uploadOpen = viewer === "reporter" && open && photos.length < MAX_PHOTOS_PER_COMPLAINT;
  const pending = analyses.some((entry) => entry.state === "analysing");

  if (photos.length === 0 && !uploadOpen) {
    return null;
  }

  return (
    <section
      aria-labelledby="photos-title"
      // A container: the photo sits beside its analysis only where the section itself is wide
      // (the reporter's page), and above it in the narrow action column of staff pages.
      className="@container space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="photos-title" className="text-lg font-semibold text-ink">
        Photos
      </h2>
      {photos.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No photos yet. A photo helps staff see the problem before they visit.
        </p>
      ) : (
        <ul className="space-y-5">
          {photos.map((photo, index) => {
            const analysis = analysisFor.get(photo.id);
            return (
              <li
                key={photo.id}
                className="grid gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0 @lg:grid-cols-[10rem_minmax(0,1fr)]"
              >
                <div className="aspect-square w-40 overflow-hidden rounded-lg border border-line bg-surface-muted @lg:w-full">
                  {photo.url === null ? (
                    <span className="flex size-full items-center justify-center p-2 text-center text-xs text-ink-muted">
                      Photo unavailable right now
                    </span>
                  ) : (
                    <Image
                      src={photo.url}
                      alt={`Photo ${String(index + 1)} attached to this report`}
                      width={320}
                      height={320}
                      unoptimized
                      className="size-full object-cover"
                    />
                  )}
                </div>
                {analysis === undefined ? null : (
                  <AnalysisCard
                    complaintId={complaintId}
                    photo={analysis}
                    viewer={viewer}
                    canRespond={open}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {uploadOpen ? <PhotoUploader endpoint={`/api/complaints/${complaintId}/photos`} /> : null}
      {pending ? <PendingRefresh /> : null}
    </section>
  );
}
