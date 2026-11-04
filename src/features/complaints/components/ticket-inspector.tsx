import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CATEGORY_LABELS, isComplaintCategory } from "../categories";
import type { ComplaintDetail } from "../repository";

import { StatusBadge } from "./status-badge";
import { PriorityBadge, locationOf } from "./ticket-parts";
import { Timeline } from "./timeline";

const iconLink =
  "inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink";

/**
 * A queue's inspection panel: the selected ticket beside the table on wide screens, with its
 * description, actions and history. It is driven by `?ticket=`, so the view is a shareable URL,
 * and it holds nothing the full ticket page does not.
 */
export function TicketInspector({
  complaint,
  closeHref,
  fullHref,
  actions,
  justChanged = false,
}: {
  readonly complaint: ComplaintDetail;
  readonly closeHref: string;
  readonly fullHref: string;
  readonly actions?: ReactNode;
  /** An action from the panel just added the newest history entry. */
  readonly justChanged?: boolean;
}) {
  return (
    <section
      aria-labelledby="inspector-title"
      tabIndex={-1}
      className="space-y-6 rounded-xl border border-line bg-surface p-5 shadow-soft xl:sticky xl:top-6"
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-ink-subtle">
              {complaint.reference}
            </span>
            <StatusBadge status={complaint.status} />
            {complaint.priority === "unassessed" ? null : (
              <PriorityBadge priority={complaint.priority} />
            )}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 items-center">
            <Link href={fullHref} className={iconLink}>
              <Maximize2 aria-hidden="true" className="size-4" />
              <span className="sr-only">Open the full ticket page</span>
            </Link>
            <Link href={closeHref} className={iconLink}>
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Close the ticket panel</span>
            </Link>
          </div>
        </div>
        <h2 id="inspector-title" className="text-lg font-semibold text-balance text-ink">
          {complaint.title}
        </h2>
        <p className="text-sm text-ink-muted">
          {locationOf(complaint)}
          {isComplaintCategory(complaint.category)
            ? ` · ${CATEGORY_LABELS[complaint.category]}`
            : null}
        </p>
      </header>

      <p className="text-sm text-pretty whitespace-pre-wrap text-ink-muted">
        {complaint.description}
      </p>

      {actions}

      <section aria-labelledby="inspector-history-title" className="space-y-4">
        <h3 id="inspector-history-title" className="text-sm font-semibold text-ink">
          History
        </h3>
        <Timeline events={complaint.events} highlightLatest={justChanged} />
      </section>
    </section>
  );
}
