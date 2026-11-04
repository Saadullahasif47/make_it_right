import { ArrowRight, SearchX, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { listAllDepartments } from "@/features/admin/config";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintTable } from "@/features/complaints/components/complaint-table";
import {
  FilterTabs,
  SortLinks,
  isListSort,
  listHref,
  type ListState,
} from "@/features/complaints/components/list-controls";
import { SearchForm } from "@/features/complaints/components/search-form";
import { decodeCursor } from "@/features/complaints/cursor";
import { listComplaints } from "@/features/complaints/repository";
import { PAGE_SIZE, searchQuerySchema } from "@/features/complaints/schemas";
import { STATUS_FILTERS, isStatusFilter } from "@/features/complaints/statuses";
import { requestTime } from "@/lib/request-time";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "All tickets" };

const DEFAULTS = { filter: "all", sort: "newest" } as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function AllTickets({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/tickets">["searchParams"];
}) {
  const access = await requirePageAccess(["admin"], "/admin/tickets");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const params = await searchParams;
  const statusParam = first(params.status);
  const sortParam = first(params.sort);
  // Over-long or malformed search text is ignored rather than turned into an error page.
  const parsedQuery = searchQuerySchema.safeParse(first(params.q));
  const state: ListState = {
    filter: isStatusFilter(statusParam) ? statusParam : DEFAULTS.filter,
    sort: isListSort(sortParam) ? sortParam : DEFAULTS.sort,
    query: parsedQuery.success ? parsedQuery.data : undefined,
  };
  const cursor = decodeCursor(first(params.cursor));

  const supabase = await createSupabaseServerClient();
  const [page, departments, now] = await Promise.all([
    listComplaints(supabase, {
      limit: PAGE_SIZE.default,
      cursor,
      statuses: STATUS_FILTERS[state.filter].states,
      sort: state.sort,
      query: state.query,
    }),
    listAllDepartments(supabase),
    requestTime(),
  ]);
  const departmentNames = new Map(
    departments.map((department) => [department.id, department.name]),
  );
  const href = (next: Partial<ListState>) =>
    listHref("/admin/tickets", { ...state, ...next }, DEFAULTS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="All tickets"
        description="Every ticket on campus. Search by title, place or reference, filter by status, and open one to route or follow it."
      />

      <div className="space-y-3">
        <SearchForm
          action="/admin/tickets"
          label="Search all tickets"
          query={state.query}
          keep={{
            ...(state.filter === DEFAULTS.filter ? {} : { status: state.filter }),
            ...(state.sort === DEFAULTS.sort ? {} : { sort: state.sort }),
          }}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs
            active={state.filter}
            hrefFor={(filter) => href({ filter, cursor: undefined })}
          />
          <SortLinks
            active={state.sort}
            options={["newest", "oldest", "priority"]}
            hrefFor={(sort) => href({ sort, cursor: undefined })}
          />
        </div>
      </div>

      {page.items.length > 0 ? (
        <ComplaintTable
          complaints={page.items}
          hrefFor={(id) => `/admin/complaints/${id}`}
          variant="admin"
          now={now}
          departmentNames={departmentNames}
        />
      ) : state.query === undefined ? (
        <EmptyState icon={Ticket} title="No tickets in this view">
          Tickets appear here as soon as students report them.
        </EmptyState>
      ) : (
        <EmptyState icon={SearchX} title="No matching tickets">
          Nothing matches “{state.query}”.{" "}
          <Link
            href={href({ query: undefined, cursor: undefined })}
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Clear search
          </Link>
        </EmptyState>
      )}

      {page.nextCursor === null ? null : (
        <div className="flex justify-end">
          <ButtonLink href={href({ cursor: page.nextCursor })} variant="secondary" size="sm">
            More tickets
            <ArrowRight aria-hidden="true" className={buttonIcon} />
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

export default function AdminTicketsPage({ searchParams }: PageProps<"/admin/tickets">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AllTickets searchParams={searchParams} />
    </Suspense>
  );
}
