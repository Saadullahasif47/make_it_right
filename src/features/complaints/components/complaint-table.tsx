import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LocalTime } from "@/components/ui/local-time";
import { cn } from "@/lib/utils/cn";

import { ticketAge } from "../age";
import type { ComplaintSummary } from "../repository";
import { ACKNOWLEDGEABLE_STATES, isStalledTriage, reviewReason } from "../workflow";

import { StatusBadge } from "./status-badge";
import { NewMarker, PriorityBadge, StalledMarker, locationOf } from "./ticket-parts";

/**
 * Who is reading the list decides its columns:
 *   reporter  reference, issue, status, reported
 *   staff     reference, issue, priority, status, age, acknowledged
 *   admin     reference, issue, priority, status, department, age
 *   review    reference, issue, why it waits, age
 */
export type TableVariant = "reporter" | "staff" | "admin" | "review";

interface Column {
  readonly header: string;
  readonly className?: string;
  readonly cell: (complaint: ComplaintSummary) => ReactNode;
}

interface ComplaintTableProps {
  readonly complaints: readonly ComplaintSummary[];
  /** Where a row leads from the desktop table. */
  readonly hrefFor: (id: string) => string;
  /** Where a row leads from the phone list, when that differs (the full page, not a panel). */
  readonly phoneHrefFor?: (id: string) => string;
  readonly variant?: TableVariant;
  /** Request time; required for the age and review columns. */
  readonly now?: number;
  /** Department names by id, for the admin variant. */
  readonly departmentNames?: ReadonlyMap<string, string>;
  /** The ticket open in the inspection panel: highlighted, and the table drops to fewer columns. */
  readonly selectedId?: string | undefined;
}

function Age({ createdAt, now }: { readonly createdAt: string; readonly now: number }) {
  const age = ticketAge(createdAt, now);
  return (
    <>
      <span aria-hidden="true">{age.short}</span>
      <span className="sr-only">{age.long}</span>
    </>
  );
}

const isNew = (complaint: ComplaintSummary) =>
  complaint.acknowledgedAt === null && ACKNOWLEDGEABLE_STATES.includes(complaint.status);

function columnsFor(
  variant: TableVariant,
  now: number,
  departmentNames: ReadonlyMap<string, string>,
  compact: boolean,
): readonly Column[] {
  const status: Column = {
    header: "Status",
    className: "w-36",
    cell: (complaint) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={complaint.status} />
        {compact && variant === "staff" && isNew(complaint) ? <NewMarker /> : null}
        {variant !== "reporter" && isStalledTriage(complaint, now) ? <StalledMarker /> : null}
      </span>
    ),
  };
  const priority: Column = {
    header: "Priority",
    className: "w-40",
    cell: (complaint) => <PriorityBadge priority={complaint.priority} />,
  };
  const age: Column = {
    header: "Age",
    className: "w-20",
    cell: (complaint) => <Age createdAt={complaint.createdAt} now={now} />,
  };

  switch (variant) {
    case "reporter":
      return [
        status,
        {
          header: "Reported",
          className: "w-48",
          cell: (complaint) => <LocalTime value={complaint.createdAt} />,
        },
      ];
    case "staff":
      // Beside the inspection panel the table keeps what tells tickets apart; the panel has the rest.
      if (compact) return [priority, status];
      return [
        priority,
        status,
        age,
        {
          header: "Acknowledged",
          className: "w-32",
          cell: (complaint) => (isNew(complaint) ? <NewMarker /> : "Yes"),
        },
      ];
    case "admin":
      return [
        priority,
        status,
        {
          header: "Department",
          className: "w-44",
          cell: (complaint) =>
            complaint.assignedDepartmentId === null
              ? "Not assigned"
              : (departmentNames.get(complaint.assignedDepartmentId) ?? "Unknown department"),
        },
        age,
      ];
    case "review":
      return [
        {
          header: "Why it waits",
          className: "w-48",
          cell: (complaint) => reviewReason(complaint, now),
        },
        age,
      ];
  }
}

const headerCell = "px-4 py-2.5 text-left text-xs font-medium text-ink-muted";

/**
 * A list of tickets: a table on desktop, where columns make tickets easy to compare, and compact
 * rows on phones. Only one of the two is ever displayed, so assistive technology meets a single
 * list either way.
 */
export function ComplaintTable({
  complaints,
  hrefFor,
  phoneHrefFor = hrefFor,
  variant = "reporter",
  now = 0,
  departmentNames = new Map(),
  selectedId,
}: ComplaintTableProps) {
  const columns = columnsFor(variant, now, departmentNames, selectedId !== undefined);
  // Four reporter columns fit a tablet; the staff and admin column sets need a laptop's width,
  // so below 1024 px those lists use the compact rows instead of truncating every title.
  const wide = variant === "reporter";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <table
        aria-label="Complaints"
        className={cn("hidden w-full text-sm", wide ? "md:table" : "lg:table")}
      >
        <thead className="border-b border-line bg-surface-muted">
          <tr>
            <th scope="col" className={`${headerCell} w-28`}>
              Reference
            </th>
            <th scope="col" className={headerCell}>
              Issue
            </th>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={cn(headerCell, column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {complaints.map((complaint) => {
            const selected = complaint.id === selectedId;
            return (
              <tr
                key={complaint.id}
                className={cn(
                  "transition-colors",
                  selected ? "bg-brand-soft" : "hover:bg-surface-muted",
                )}
              >
                <td
                  className={cn(
                    "px-4 py-3 align-top font-mono text-xs font-semibold whitespace-nowrap",
                    // The subtle grey loses contrast on the selection tint.
                    selected ? "text-ink-muted" : "text-ink-subtle",
                  )}
                >
                  {complaint.reference}
                </td>
                <td className="max-w-0 px-4 py-3 align-top">
                  <Link
                    href={hrefFor(complaint.id)}
                    aria-current={selected ? "true" : undefined}
                    className="block truncate font-medium text-ink underline-offset-4 hover:text-brand-strong hover:underline"
                  >
                    {complaint.title}
                  </Link>
                  <p className="mt-0.5 truncate text-ink-muted">{locationOf(complaint)}</p>
                </td>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className="px-4 py-3 align-top whitespace-nowrap text-ink-muted"
                  >
                    {column.cell(complaint)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul
        aria-label="Complaints"
        className={cn("divide-y divide-line", wide ? "md:hidden" : "lg:hidden")}
      >
        {complaints.map((complaint) => (
          <li key={complaint.id}>
            <Link
              href={phoneHrefFor(complaint.id)}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="font-mono text-xs font-semibold text-ink-subtle">
                    {complaint.reference}
                  </span>
                  <StatusBadge status={complaint.status} />
                  {variant === "reporter" ? null : (
                    <>
                      {complaint.priority === "unassessed" ? null : (
                        <PriorityBadge priority={complaint.priority} />
                      )}
                      {variant === "staff" && isNew(complaint) ? <NewMarker /> : null}
                      {isStalledTriage(complaint, now) ? <StalledMarker /> : null}
                    </>
                  )}
                </div>
                <p className="mt-1.5 truncate font-medium text-ink">{complaint.title}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-ink-muted">
                  <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{locationOf(complaint)}</span>
                  {variant === "reporter" ? null : (
                    <span className="shrink-0">
                      {" · "}
                      {variant === "review" ? (
                        reviewReason(complaint, now)
                      ) : (
                        <Age createdAt={complaint.createdAt} now={now} />
                      )}
                    </span>
                  )}
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
