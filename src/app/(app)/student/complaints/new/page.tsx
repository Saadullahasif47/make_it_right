import { randomUUID } from "node:crypto";

import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintForm } from "@/features/complaints/components/complaint-form";

export const metadata: Metadata = { title: "Report an issue" };

async function NewComplaint() {
  const access = await requirePageAccess(["student"], "/student/complaints/new");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
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
      <PageHeader
        eyebrow="New report"
        title="Report an issue"
        description="Tell us what is broken and where. Your report is saved straight away, then routed to the right department."
      />
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8">
        {/* One key per rendered form: retries and double submits can never create two tickets. */}
        <ComplaintForm idempotencyKey={randomUUID()} />
      </div>
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
        Only you and the staff handling it can see your report. This is a coursework prototype: use
        fictional details.
      </p>
    </div>
  );
}

export default function NewComplaintPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewComplaint />
    </Suspense>
  );
}
