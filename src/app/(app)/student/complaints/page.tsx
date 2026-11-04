import { ArrowRight, ClipboardList, Plus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader, Skeleton, SkeletonRows } from "@/components/layout/page-parts";
import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintTable } from "@/features/complaints/components/complaint-table";
import { FilterTabs } from "@/features/complaints/components/list-controls";
import { SearchForm } from "@/features/complaints/components/search-form";
import { decodeCursor } from "@/features/complaints/cursor";
import {
  countComplaints,
  listComplaints,
  type ComplaintCounts,
} from "@/features/complaints/repository";
import { PAGE_SIZE, searchQuerySchema } from "@/features/complaints/schemas";
import { STATUS_FILTERS, isStatusFilter, type StatusFilter } from "@/features/complaints/statuses";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PageNotice } from "../../_components/page-notice";

export const metadata: Metadata = { title: "My complaints" };

type SearchParams = PageProps<"/student/complaints">["searchParams"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface ListView {
  readonly filter: StatusFilter;
  readonly query?: string | undefined;
}

function listHref({ filter, query }: ListView, cursor?: string): string {
  const params = new URLSearchParams();
  if (query !== undefined) params.set("q", query);
  if (filter !== "all") params.set("status", filter);
  if (cursor !== undefined) params.set("cursor", cursor);
  const search = params.toString();
  return search === "" ? "/student/complaints" : `/student/complaints?${search}`;
}

const linkClassName = "font-semibold text-brand underline-offset-4 hover:underline";

/** Where the student's tickets stand. "Resolved" waits on the student, so it says so. */
function SummaryStrip({ counts }: { readonly counts: ComplaintCounts }) {
  const items = [
    { label: "Open", value: counts.open },
    { label: "Awaiting your confirmation", value: counts.resolved },
    { label: "Closed", value: counts.closed },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col justify-between gap-1.5 px-4 py-3 sm:px-5">
          <dt className="text-xs text-ink-muted sm:text-sm">{item.label}</dt>
          <dd className="text-xl font-semibold tracking-tight text-ink tabular-nums sm:text-2xl">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function StudentComplaints({ searchParams }: { readonly searchParams: SearchParams }) {
  const access = await requirePageAccess(["student"], "/student/complaints");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const params = await searchParams;
  const statusParam = first(params.status);
  // Over-long or malformed search text is ignored rather than turned into an error page.
  const parsedQuery = searchQuerySchema.safeParse(first(params.q));
  const view: ListView = {
    filter: isStatusFilter(statusParam) ? statusParam : "all",
    query: parsedQuery.success ? parsedQuery.data : undefined,
  };
  // An unknown or tampered cursor simply starts from the newest page.
  const cursor = decodeCursor(first(params.cursor));

  const client = await createSupabaseServerClient();
  const [page, counts] = await Promise.all([
    listComplaints(client, {
      limit: PAGE_SIZE.default,
      cursor,
      statuses: STATUS_FILTERS[view.filter].states,
      query: view.query,
    }),
    countComplaints(client),
  ]);

  const firstName = access.user.displayName?.split(" ")[0];
  const hasAny = counts.open + counts.resolved + counts.closed > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName === undefined ? "My complaints" : `Hi ${firstName}, here are your reports`}
        description="Everything you have reported, with its status and history. Only you can see these."
        actions={
          <ButtonLink href="/student/complaints/new">
            <Plus aria-hidden="true" className="size-4" />
            Report an issue
          </ButtonLink>
        }
      />

      <PageNotice searchParams={searchParams} />

      {hasAny ? (
        <>
          <SummaryStrip counts={counts} />
          <div className="space-y-3">
            <SearchForm
              action="/student/complaints"
              label="Search your reports"
              query={view.query}
              keep={view.filter === "all" ? {} : { status: view.filter }}
            />
            <FilterTabs active={view.filter} hrefFor={(filter) => listHref({ ...view, filter })} />
          </div>
        </>
      ) : null}

      {page.items.length > 0 ? (
        <ComplaintTable complaints={page.items} hrefFor={(id) => `/student/complaints/${id}`} />
      ) : !hasAny ? (
        <EmptyState icon={ClipboardList} title="No complaints yet">
          When something on campus needs fixing, report it here. You will get a reference number and
          can follow every step.
        </EmptyState>
      ) : view.query === undefined ? (
        <EmptyState icon={ClipboardList} title="Nothing to show">
          No reports match this view.{" "}
          <Link href={listHref({ filter: "all" })} className={linkClassName}>
            Show all reports
          </Link>
        </EmptyState>
      ) : (
        <EmptyState icon={SearchX} title="No matching reports">
          Nothing matches “{view.query}”. Try a word from the title, the building or the reference
          number.{" "}
          <Link href={listHref({ filter: view.filter })} className={linkClassName}>
            Clear search
          </Link>
        </EmptyState>
      )}

      {cursor === undefined && page.nextCursor === null ? null : (
        <div className="flex items-center justify-between gap-4">
          {cursor === undefined ? (
            <span />
          ) : (
            <Link
              href={listHref(view)}
              className="text-sm font-semibold text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Back to newest
            </Link>
          )}
          {page.nextCursor === null ? null : (
            <ButtonLink href={listHref(view, page.nextCursor)} variant="secondary" size="sm">
              Older reports
              <ArrowRight aria-hidden="true" className={buttonIcon} />
            </ButtonLink>
          )}
        </div>
      )}
    </div>
  );
}

/** Matches the loaded page: header, summary strip, search, filters and table rows. */
function StudentComplaintsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-10 w-full" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton key={tab} className="h-8 w-20" />
        ))}
      </div>
      <SkeletonRows />
    </div>
  );
}

export default function StudentComplaintsPage({ searchParams }: PageProps<"/student/complaints">) {
  return (
    <Suspense fallback={<StudentComplaintsSkeleton />}>
      <StudentComplaints searchParams={searchParams} />
    </Suspense>
  );
}
