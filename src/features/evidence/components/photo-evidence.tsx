import "server-only";

import Image from "next/image";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import { MAX_PHOTOS_PER_COMPLAINT } from "../image";
import { listPhotos } from "../service";

import { PhotoUploader } from "./photo-uploader";

interface PhotoEvidenceProps {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
  /** The reporter may add photos while the ticket is open. */
  readonly canUpload: boolean;
}

/** The private photos on a report (plan v2 F1), shown through short-lived signed URLs. */
export async function PhotoEvidence({ client, complaintId, canUpload }: PhotoEvidenceProps) {
  const photos = await listPhotos(client, complaintId);
  const uploadOpen = canUpload && photos.length < MAX_PHOTOS_PER_COMPLAINT;

  return (
    <section
      aria-labelledby="photos-title"
      className="space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="photos-title" className="text-lg font-semibold text-ink">
        Photos
      </h2>
      {photos.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No photos yet. A photo helps staff see the problem before they visit.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="aspect-square overflow-hidden rounded-lg border border-line bg-surface-muted"
            >
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
            </li>
          ))}
        </ul>
      )}
      {uploadOpen ? <PhotoUploader complaintId={complaintId} /> : null}
    </section>
  );
}
