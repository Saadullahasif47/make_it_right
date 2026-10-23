import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LocalTime } from "@/components/ui/local-time";
import { Notice } from "@/components/ui/notice";

import { CATEGORY_LABELS, isComplaintCategory } from "../categories";
import type { ComplaintDetail } from "../repository";

import { PriorityBadge, locationOf } from "./complaint-list";
import { StatusBadge } from "./status-badge";
import { Timeline } from "./timeline";

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

interface ComplaintDetailViewProps {
  readonly complaint: ComplaintDetail;
  readonly back: { readonly href: string; readonly label: string };
  readonly notice?: ReactNode;
  /** Role-specific controls; rendered above the timeline. */
  readonly actions?: ReactNode;
}

/** The ticket page shared by reporters, department staff and administrators. */
export function ComplaintDetailView({
  complaint,
  back,
  notice,
  actions,
}: ComplaintDetailViewProps) {
  return (
    <div className="space-y-8">
      <Link
        href={back.href}
        className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
        />
        {back.label}
      </Link>

      {notice === undefined ? null : <Notice tone="success">{notice}</Notice>}

      <header className="animate-fade-up space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold text-ink-subtle">
            {complaint.reference}
          </span>
          <StatusBadge status={complaint.status} />
          {complaint.priority === "unassessed" ? null : (
            <PriorityBadge priority={complaint.priority} />
          )}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-balance text-ink">
          {complaint.title}
        </h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <section
            aria-labelledby="details-title"
            className="rounded-2xl border border-line bg-surface p-6 shadow-soft"
          >
            <h2 id="details-title" className="sr-only">
              Details
            </h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="Location">{locationOf(complaint)}</Detail>
              <Detail label="Reported">
                <LocalTime value={complaint.createdAt} />
              </Detail>
              <Detail label="Category">
                {isComplaintCategory(complaint.category)
                  ? CATEGORY_LABELS[complaint.category]
                  : "Awaiting classification"}
              </Detail>
              <Detail label="Assigned to">{complaint.departmentName ?? "Not yet assigned"}</Detail>
            </dl>
          </section>

          <section aria-labelledby="description-title" className="space-y-3">
            <h2 id="description-title" className="text-lg font-bold text-ink">
              Description
            </h2>
            <p className="text-pretty whitespace-pre-wrap text-ink-muted">
              {complaint.description}
            </p>
          </section>
        </div>

        <div className="space-y-6">
          {actions}
          <section
            aria-labelledby="history-title"
            className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-soft"
          >
            <h2 id="history-title" className="text-lg font-bold text-ink">
              History
            </h2>
            <Timeline events={complaint.events} />
          </section>
        </div>
      </div>
    </div>
  );
}
