import { ArrowRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
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
import { TicketInspector } from "@/features/complaints/components/ticket-inspector";
import { WorkflowPanel } from "@/features/complaints/components/workflow-panel";
import { decodeCursor } from "@/features/complaints/cursor";
import { WORKFLOW_NOTICES } from "@/features/complaints/paths";
import { getComplaint, listComplaints } from "@/features/complaints/repository";
import { PAGE_SIZE, complaintIdSchema } from "@/features/complaints/schemas";
import { STATUS_FILTERS, isStatusFilter } from "@/features/complaints/statuses";
import { requestTime } from "@/lib/request-time";
import { cn } from "@/lib/utils/cn";
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
  const ticketParam = complaintIdSchema.safeParse(first(params.ticket));
  const state: ListState = {
    filter: isStatusFilter(statusParam) ? statusParam : DEFAULTS.filter,
    sort: isListSort(sortParam) ? sortParam : DEFAULTS.sort,
    cursor: first(params.cursor),
    ticket: ticketParam.success ? ticketParam.data : undefined,
  };
  const cursor = decodeCursor(state.cursor);

  const supabase = await createSupabaseServerClient();
  // RLS limits the queue, and the panel, to tickets assigned to the caller's own department.
  const [page, department, selected, now] = await Promise.all([
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
    state.ticket === undefined ? Promise.resolve(null) : getComplaint(supabase, state.ticket),
    requestTime(),
  ]);
  const departmentName = department?.data?.name ?? "Your department";
  const href = (next: Partial<ListState>) =>
    listHref("/department", { ...state, ...next }, DEFAULTS);
  const workflowNotice = WORKFLOW_NOTICES[first(params.notice) ?? ""];

  return (
    <div className="space-y-6">
      <PageHeader
        title={departmentName}
        description="Tickets assigned to your department. Acknowledge new ones, start work, and resolve them with a note."
      />
      <PageNotice searchParams={searchParams} />
      {workflowNotice === undefined ? null : <Toast>{workflowNotice}</Toast>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterTabs
          active={state.filter}
          hrefFor={(filter) => href({ filter, cursor: undefined, ticket: undefined })}
          labels={{ open: "Active" }}
        />
        <SortLinks
          active={state.sort}
          options={["oldest", "priority", "newest"]}
          hrefFor={(sort) => href({ sort, cursor: undefined })}
        />
      </div>

      <div
        className={cn(
          "grid items-start gap-6",
          selected !== null && "xl:grid-cols-[minmax(0,1fr)_24rem]",
        )}
      >
        <div className="min-w-0 space-y-4">
          {page.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={cursor === undefined ? "Nothing in this view" : "No more tickets"}
              action={
                state.filter === DEFAULTS.filter && cursor === undefined ? undefined : (
                  <ButtonLink
                    href={href({ filter: DEFAULTS.filter, cursor: undefined, ticket: undefined })}
                    variant="secondary"
                    size="sm"
                  >
                    Show active tickets
                  </ButtonLink>
                )
              }
            >
              {state.filter === "open"
                ? `No active tickets for ${departmentName} right now. New assignments appear here.`
                : "No tickets match this view."}
            </EmptyState>
          ) : (
            <ComplaintTable
              complaints={page.items}
              hrefFor={(id) => href({ ticket: id })}
              phoneHrefFor={(id) => `/department/${id}`}
              variant="staff"
              now={now}
              selectedId={selected?.id}
            />
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

        {selected === null ? null : (
          <div className="order-first xl:order-last">
            <TicketInspector
              complaint={selected}
              closeHref={href({ ticket: undefined })}
              fullHref={`/department/${selected.id}`}
              justChanged={workflowNotice !== undefined}
              actions={
                <WorkflowPanel
                  ticketId={selected.id}
                  version={selected.version}
                  status={selected.status}
                  acknowledgedAt={selected.acknowledgedAt}
                  role={access.user.role}
                  view="panel"
                />
              }
            />
          </div>
        )}
      </div>
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
