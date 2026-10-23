import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { PageSkeleton } from "@/components/layout/page-parts";
import { LocalTime } from "@/components/ui/local-time";
import { Notice } from "@/components/ui/notice";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import { locationOf } from "@/features/complaints/components/complaint-list";
import { StatusBadge } from "@/features/complaints/components/status-badge";
import { Timeline } from "@/features/complaints/components/timeline";
import { getComplaint } from "@/features/complaints/repository";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { PRIORITY_LABELS } from "@/features/complaints/statuses";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complaint" };

const NOTICES: Readonly<Record<string, string>> = {
  created: "Your report has been saved. We will route it to the right department.",
  "already-submitted": "This report was already saved, so we did not create a duplicate.",
};

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

async function ComplaintDetail({
  params,
  searchParams,
}: {
  readonly params: PageProps<"/student/complaints/[id]">["params"];
  readonly searchParams: PageProps<"/student/complaints/[id]">["searchParams"];
}) {
  const { id } = await params;
  const access = await requirePageAccess(["student"], `/student/complaints/${id}`);
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const parsedId = complaintIdSchema.safeParse(id);
  // RLS returns nothing for someone else's ticket, which is indistinguishable from "missing".
  const complaint = parsedId.success
    ? await getComplaint(await createSupabaseServerClient(), parsedId.data)
    : null;
  if (complaint === null) {
    notFound();
  }

  const rawNotice = (await searchParams).notice;
  const notice = NOTICES[Array.isArray(rawNotice) ? (rawNotice[0] ?? "") : (rawNotice ?? "")];

  return (
    <div className="space-y-8">
      <Link
        href="/student/complaints"
        className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
        />
        My complaints
      </Link>

      {notice === undefined ? null : (
        <Notice tone="success">
          {notice} Your reference is{" "}
          <strong className="font-mono whitespace-nowrap">{complaint.reference}</strong>.
        </Notice>
      )}

      <header className="animate-fade-up space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold text-ink-subtle">
            {complaint.reference}
          </span>
          <StatusBadge status={complaint.status} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-balance text-ink">
          {complaint.title}
        </h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <section
            aria-labelledby="details-title"
            className="rounded-2xl border border-line bg-surface p-6 shadow-soft"
          >
            <h2 id="details-title" className="sr-only">
              Details
            </h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="Location">{locationOf(complaint)}</Detail>
              <Detail label="Reported">
                <LocalTime value={complaint.createdAt} />
              </Detail>
              <Detail label="Category">
                {isComplaintCategory(complaint.category)
                  ? CATEGORY_LABELS[complaint.category]
                  : "Awaiting classification"}
              </Detail>
              <Detail label="Priority">{PRIORITY_LABELS[complaint.priority]}</Detail>
              <Detail label="Assigned to">{complaint.departmentName ?? "Not yet assigned"}</Detail>
            </dl>
          </section>

          <section aria-labelledby="description-title" className="space-y-3">
            <h2 id="description-title" className="text-lg font-bold text-ink">
              Description
            </h2>
            <p className="text-pretty whitespace-pre-wrap text-ink-muted">
              {complaint.description}
            </p>
          </section>
        </div>

        <section
          aria-labelledby="history-title"
          className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-soft"
        >
          <h2 id="history-title" className="text-lg font-bold text-ink">
            History
          </h2>
          <Timeline events={complaint.events} />
        </section>
      </div>
    </div>
  );
}

export default function ComplaintDetailPage({
  params,
  searchParams,
}: PageProps<"/student/complaints/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ComplaintDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}
