import { ArrowRight, ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintList } from "@/features/complaints/components/complaint-list";
import { decodeCursor } from "@/features/complaints/cursor";
import { listComplaints } from "@/features/complaints/repository";
import { PAGE_SIZE } from "@/features/complaints/schemas";
import {
  STATUS_FILTERS,
  STATUS_FILTER_ORDER,
  isStatusFilter,
  type StatusFilter,
} from "@/features/complaints/statuses";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

import { PageNotice } from "../../_components/page-notice";

export const metadata: Metadata = { title: "My complaints" };

type SearchParams = PageProps<"/student/complaints">["searchParams"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function listHref(filter: StatusFilter, cursor?: string): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (cursor !== undefined) params.set("cursor", cursor);
  const query = params.toString();
  return query === "" ? "/student/complaints" : `/student/complaints?${query}`;
}

function FilterTabs({ active }: { readonly active: StatusFilter }) {
  return (
    <nav aria-label="Filter by status">
      <ul className="flex flex-wrap gap-2">
        {STATUS_FILTER_ORDER.map((filter) => (
          <li key={filter}>
            <Link
              href={listHref(filter)}
              aria-current={filter === active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold transition-[background-color,border-color,color] duration-200",
                filter === active
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-line-strong bg-surface text-ink-muted hover:border-brand hover:text-ink",
              )}
            >
              {STATUS_FILTERS[filter].label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function StudentComplaints({ searchParams }: { readonly searchParams: SearchParams }) {
  const access = await requirePageAccess(["student"], "/student/complaints");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const params = await searchParams;
  const statusParam = first(params.status);
  const filter: StatusFilter = isStatusFilter(statusParam) ? statusParam : "all";
  // An unknown or tampered cursor simply starts from the newest page.
  const cursor = decodeCursor(first(params.cursor));

  const page = await listComplaints(await createSupabaseServerClient(), {
    limit: PAGE_SIZE.default,
    cursor,
    statuses: STATUS_FILTERS[filter].states,
  });

  const firstName = access.user.displayName?.split(" ")[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow="Student"
          title={
            firstName === undefined ? "My complaints" : `Hi ${firstName}, here are your reports`
          }
          description="Every issue you report appears here with its status and full history. Only you can see these."
        />
        <ButtonLink href="/student/complaints/new" className="self-start sm:self-auto">
          <Plus
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-hover:rotate-90"
          />
          Report an issue
        </ButtonLink>
      </div>

      <PageNotice searchParams={searchParams} />
      <FilterTabs active={filter} />

      {page.items.length === 0 ? (
        cursor === undefined && filter === "all" ? (
          <EmptyState icon={ClipboardList} title="No complaints yet">
            When something on campus needs fixing, report it here. You will get a reference number
            and can follow every step.
          </EmptyState>
        ) : (
          <EmptyState icon={ClipboardList} title="Nothing to show">
            No reports match this view.{" "}
            <Link
              href={listHref("all")}
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              Show all reports
            </Link>
          </EmptyState>
        )
      ) : (
        <ComplaintList complaints={page.items} hrefFor={(id) => `/student/complaints/${id}`} />
      )}

      <div className="flex items-center justify-between gap-4">
        {cursor === undefined ? (
          <span />
        ) : (
          <Link
            href={listHref(filter)}
            className="text-sm font-semibold text-ink-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Back to newest
          </Link>
        )}
        {page.nextCursor === null ? null : (
          <ButtonLink href={listHref(filter, page.nextCursor)} variant="secondary" size="sm">
            Older reports
            <ArrowRight aria-hidden="true" className={buttonIconSlide} />
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export default function StudentComplaintsPage({ searchParams }: PageProps<"/student/complaints">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StudentComplaints searchParams={searchParams} />
    </Suspense>
  );
}
