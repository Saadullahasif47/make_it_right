import { ArrowRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintList } from "@/features/complaints/components/complaint-list";
import {
  FilterTabs,
  SortLinks,
  isListSort,
  listHref,
  type ListState,
} from "@/features/complaints/components/list-controls";
import { decodeCursor } from "@/features/complaints/cursor";
import { listComplaints } from "@/features/complaints/repository";
import { PAGE_SIZE } from "@/features/complaints/schemas";
import { STATUS_FILTERS, isStatusFilter } from "@/features/complaints/statuses";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PageNotice } from "../_components/page-notice";

export const metadata: Metadata = { title: "Department queue" };

const DEFAULTS = { filter: "open", sort: "oldest" } as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function DepartmentQueue({
  searchParams,
}: {
  readonly searchParams: PageProps<"/department">["searchParams"];
}) {
  const access = await requirePageAccess(["department"], "/department");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const params = await searchParams;
  const statusParam = first(params.status);
  const sortParam = first(params.sort);
  const state: ListState = {
    filter: isStatusFilter(statusParam) ? statusParam : DEFAULTS.filter,
    sort: isListSort(sortParam) ? sortParam : DEFAULTS.sort,
  };
  const cursor = decodeCursor(first(params.cursor));

  const supabase = await createSupabaseServerClient();
  // RLS limits this to tickets assigned to the caller's own department (P3.04).
  const [page, department] = await Promise.all([
    listComplaints(supabase, {
      limit: PAGE_SIZE.default,
      cursor,
      statuses: STATUS_FILTERS[state.filter].states,
      sort: state.sort,
    }),
    access.user.departmentId === null
      ? Promise.resolve(null)
      : supabase
          .from("departments")
          .select("name")
          .eq("id", access.user.departmentId)
          .maybeSingle(),
  ]);
  const departmentName = department?.data?.name ?? "Your department";
  const href = (next: Partial<ListState>) =>
    listHref("/department", { ...state, ...next }, DEFAULTS);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Department queue"
        title={departmentName}
        description="Tickets assigned to your department. Acknowledge new ones, start work, and resolve them with a note."
      />
      <PageNotice searchParams={searchParams} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <FilterTabs
          active={state.filter}
          hrefFor={(filter) => href({ filter, cursor: undefined })}
          labels={{ open: "Active" }}
        />
        <SortLinks
          active={state.sort}
          options={["oldest", "priority", "newest"]}
          hrefFor={(sort) => href({ sort, cursor: undefined })}
        />
      </div>

      {page.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={cursor === undefined ? "Nothing in this view" : "No more tickets"}
        >
          {state.filter === "open"
            ? `No active tickets for ${departmentName} right now. New assignments appear here.`
            : "No tickets match this view."}
        </EmptyState>
      ) : (
        <ComplaintList
          complaints={page.items}
          hrefFor={(id) => `/department/${id}`}
          variant="staff"
        />
      )}

      {page.nextCursor === null ? null : (
        <div className="flex justify-end">
          <ButtonLink href={href({ cursor: page.nextCursor })} variant="secondary" size="sm">
            More tickets
            <ArrowRight aria-hidden="true" className={buttonIconSlide} />
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

export default function DepartmentPage({ searchParams }: PageProps<"/department">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DepartmentQueue searchParams={searchParams} />
    </Suspense>
  );
}
