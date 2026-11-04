import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";

import type { ComplaintSummary } from "../repository";

import { locationOf } from "./complaint-list";
import { StatusBadge } from "./status-badge";

const headerCell = "px-4 py-2.5 text-left text-xs font-medium text-ink-muted";

/**
 * A reporter's tickets: a table on desktop, where columns make the list easy to compare, and
 * compact rows on phones. Only one of the two is ever displayed, so assistive technology meets a
 * single list either way.
 */
export function ComplaintTable({
  complaints,
  hrefFor,
}: {
  readonly complaints: readonly ComplaintSummary[];
  readonly hrefFor: (id: string) => string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <table aria-label="Complaints" className="hidden w-full text-sm md:table">
        <thead className="border-b border-line bg-surface-muted">
          <tr>
            <th scope="col" className={`${headerCell} w-28`}>
              Reference
            </th>
            <th scope="col" className={headerCell}>
              Issue
            </th>
            <th scope="col" className={`${headerCell} w-40`}>
              Status
            </th>
            <th scope="col" className={`${headerCell} w-48`}>
              Reported
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {complaints.map((complaint) => (
            <tr
              key={complaint.id}
              className="transition-colors duration-150 hover:bg-surface-muted"
            >
              <td className="px-4 py-3 align-top font-mono text-xs font-semibold whitespace-nowrap text-ink-subtle">
                {complaint.reference}
              </td>
              <td className="max-w-0 px-4 py-3 align-top">
                <Link
                  href={hrefFor(complaint.id)}
                  className="block truncate font-medium text-ink underline-offset-4 hover:text-brand-strong hover:underline"
                >
                  {complaint.title}
                </Link>
                <p className="mt-0.5 truncate text-ink-muted">{locationOf(complaint)}</p>
              </td>
              <td className="px-4 py-3 align-top">
                <StatusBadge status={complaint.status} />
              </td>
              <td className="px-4 py-3 align-top whitespace-nowrap text-ink-muted">
                <LocalTime value={complaint.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label="Complaints" className="divide-y divide-line md:hidden">
        {complaints.map((complaint) => (
          <li key={complaint.id}>
            <Link
              href={hrefFor(complaint.id)}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="font-mono text-xs font-semibold text-ink-subtle">
                    {complaint.reference}
                  </span>
                  <StatusBadge status={complaint.status} />
                </div>
                <p className="mt-1.5 truncate font-medium text-ink">{complaint.title}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-ink-muted">
                  <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{locationOf(complaint)}</span>
                </p>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
