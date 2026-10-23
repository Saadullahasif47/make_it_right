import Link from "next/link";

import { cn } from "@/lib/utils/cn";

import type { ListSort } from "../repository";
import { STATUS_FILTERS, STATUS_FILTER_ORDER, type StatusFilter } from "../statuses";

export const LIST_SORT_LABELS: Readonly<Record<ListSort, string>> = {
  oldest: "Oldest first",
  priority: "Most urgent",
  newest: "Newest first",
};

export function isListSort(value: unknown): value is ListSort {
  return typeof value === "string" && Object.hasOwn(LIST_SORT_LABELS, value);
}

export interface ListState {
  readonly filter: StatusFilter;
  readonly sort: ListSort;
  readonly cursor?: string | undefined;
}

/** Builds a list URL that only carries non-default values, so links stay short and bookmarkable. */
export function listHref(
  basePath: string,
  state: ListState,
  defaults: { readonly filter: StatusFilter; readonly sort: ListSort },
): string {
  const params = new URLSearchParams();
  if (state.filter !== defaults.filter) params.set("status", state.filter);
  if (state.sort !== defaults.sort) params.set("sort", state.sort);
  if (state.cursor !== undefined) params.set("cursor", state.cursor);
  const query = params.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
}

const pill =
  "inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold transition-[background-color,border-color,color] duration-200";

export function FilterTabs({
  hrefFor,
  active,
  labels,
}: {
  readonly hrefFor: (filter: StatusFilter) => string;
  readonly active: StatusFilter;
  readonly labels?: Partial<Record<StatusFilter, string>>;
}) {
  return (
    <nav aria-label="Filter by status">
      <ul className="flex flex-wrap gap-2">
        {STATUS_FILTER_ORDER.map((filter) => (
          <li key={filter}>
            <Link
              href={hrefFor(filter)}
              aria-current={filter === active ? "page" : undefined}
              className={cn(
                pill,
                filter === active
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-line-strong bg-surface text-ink-muted hover:border-brand hover:text-ink",
              )}
            >
              {labels?.[filter] ?? STATUS_FILTERS[filter].label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SortLinks({
  hrefFor,
  active,
  options,
}: {
  readonly hrefFor: (sort: ListSort) => string;
  readonly active: ListSort;
  readonly options: readonly ListSort[];
}) {
  return (
    <nav aria-label="Sort" className="flex items-center gap-1 text-sm">
      <span className="mr-1 text-ink-subtle">Sort:</span>
      {options.map((sort) => (
        <Link
          key={sort}
          href={hrefFor(sort)}
          aria-current={sort === active ? "page" : undefined}
          className={cn(
            "rounded-lg px-2.5 py-1.5 font-semibold transition-colors duration-200",
            sort === active ? "bg-surface-muted text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          {LIST_SORT_LABELS[sort]}
        </Link>
      ))}
    </nav>
  );
}
