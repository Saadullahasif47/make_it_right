import { ArrowRight, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintList } from "@/features/complaints/components/complaint-list";
import { decodeCursor } from "@/features/complaints/cursor";
import { listComplaints } from "@/features/complaints/repository";
import { PAGE_SIZE } from "@/features/complaints/schemas";
import { AWAITING_ROUTING_STATES } from "@/features/complaints/workflow";
import { requestTime } from "@/lib/request-time";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review queue" };

async function ReviewQueue({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/review">["searchParams"];
}) {
  const access = await requirePageAccess(["admin"], "/admin/review");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const now = await requestTime();
  const rawCursor = (await searchParams).cursor;
  const cursor = decodeCursor(Array.isArray(rawCursor) ? rawCursor[0] : rawCursor);
  // Oldest first: the ticket that has waited longest for a person is handled next (P3.07).
  const page = await listComplaints(await createSupabaseServerClient(), {
    limit: PAGE_SIZE.default,
    cursor,
    statuses: AWAITING_ROUTING_STATES,
    sort: "oldest",
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administrator"
        title="Review queue"
        description="Tickets waiting for a person to classify and route them, longest-waiting first: reports the AI assistant sent for review, attempts that stalled, and every new report while AI routing is off."
      />

      {page.items.length === 0 ? (
        <EmptyState icon={ListChecks} title="All caught up">
          No tickets are waiting for routing. New reports will appear here.
        </EmptyState>
      ) : (
        <ComplaintList
          complaints={page.items}
          hrefFor={(id) => `/admin/complaints/${id}`}
          variant="staff"
          now={now}
        />
      )}

      {page.nextCursor === null ? null : (
        <div className="flex justify-end">
          <ButtonLink
            href={`/admin/review?cursor=${page.nextCursor}`}
            variant="secondary"
            size="sm"
          >
            More tickets
            <ArrowRight aria-hidden="true" className={buttonIconSlide} />
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

export default function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReviewQueue searchParams={searchParams} />
    </Suspense>
  );
}
