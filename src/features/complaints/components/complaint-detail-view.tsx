import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LocalTime } from "@/components/ui/local-time";
import { Notice } from "@/components/ui/notice";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

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
  /** An inline confirmation that must stay visible (the reference of a new report). */
  readonly notice?: ReactNode;
  /** A one-off confirmation of the action that just happened. */
  readonly toast?: string | undefined;
  /** Role-specific controls; rendered above the timeline. */
  readonly actions?: ReactNode;
  /**
   * "split" puts the history beside the details (staff and admin work from it). "stacked" is
   * the reporter's reading order: the decision they owe first, then details, then a full-width
   * history.
   */
  readonly layout?: "split" | "stacked";
}

function DetailsPanel({ complaint }: { readonly complaint: ComplaintDetail }) {
  return (
    <section
      aria-labelledby="details-title"
      className="rounded-xl border border-line bg-surface p-6 shadow-soft"
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
  );
}

function Description({ text }: { readonly text: string }) {
  return (
    <section aria-labelledby="description-title" className="space-y-3">
      <h2 id="description-title" className="text-lg font-semibold text-ink">
        Description
      </h2>
      <p className="text-pretty whitespace-pre-wrap text-ink-muted">{text}</p>
    </section>
  );
}

function History({ complaint }: { readonly complaint: ComplaintDetail }) {
  return (
    <section
      aria-labelledby="history-title"
      className="space-y-5 rounded-xl border border-line bg-surface p-6 shadow-soft"
    >
      <h2 id="history-title" className="text-lg font-semibold text-ink">
        History
      </h2>
      <Timeline events={complaint.events} />
    </section>
  );
}

/** The ticket page shared by reporters, department staff and administrators. */
export function ComplaintDetailView({
  complaint,
  back,
  notice,
  toast,
  actions,
  layout = "split",
}: ComplaintDetailViewProps) {
  return (
    <div className={cn("space-y-8", layout === "stacked" && "mx-auto max-w-3xl")}>
      <Link
        href={back.href}
        className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {back.label}
      </Link>

      {notice === undefined ? null : <Notice tone="success">{notice}</Notice>}
      {toast === undefined ? null : <Toast>{toast}</Toast>}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold text-ink-subtle">
            {complaint.reference}
          </span>
          <StatusBadge status={complaint.status} />
          {complaint.priority === "unassessed" ? null : (
            <PriorityBadge priority={complaint.priority} />
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink">
          {complaint.title}
        </h1>
      </header>

      {layout === "stacked" ? (
        <>
          {actions}
          <DetailsPanel complaint={complaint} />
          <Description text={complaint.description} />
          <History complaint={complaint} />
        </>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-8">
            <DetailsPanel complaint={complaint} />
            <Description text={complaint.description} />
          </div>
          <div className="space-y-6">
            {actions}
            <History complaint={complaint} />
          </div>
        </div>
      )}
    </div>
  );
}
