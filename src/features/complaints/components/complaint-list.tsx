import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";

import type { ComplaintSummary } from "../repository";

import { StatusBadge } from "./status-badge";

export function locationOf(complaint: {
  readonly building: string;
  readonly room: string | null;
}): string {
  return complaint.room === null
    ? complaint.building
    : `${complaint.building}, room ${complaint.room}`;
}

export function ComplaintList({
  complaints,
  hrefFor,
}: {
  readonly complaints: readonly ComplaintSummary[];
  readonly hrefFor: (id: string) => string;
}) {
  return (
    <ul aria-label="Complaints" className="space-y-3">
      {complaints.map((complaint) => (
        <li key={complaint.id}>
          <Link
            href={hrefFor(complaint.id)}
            className="group flex animate-fade-up items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-soft transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift sm:p-5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs font-semibold text-ink-subtle">
                  {complaint.reference}
                </span>
                <StatusBadge status={complaint.status} />
              </div>
              <p className="mt-2 truncate font-semibold text-ink group-hover:text-brand-strong">
                {complaint.title}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  {locationOf(complaint)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Reported <LocalTime value={complaint.createdAt} />
                </span>
              </p>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="size-5 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
