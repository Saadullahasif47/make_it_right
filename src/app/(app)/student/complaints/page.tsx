import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";

import { PageNotice } from "../../_components/page-notice";

export const metadata: Metadata = { title: "My complaints" };

async function StudentComplaints({
  searchParams,
}: {
  readonly searchParams: PageProps<"/student/complaints">["searchParams"];
}) {
  const access = await requirePageAccess(["student"], "/student/complaints");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const firstName = access.user.displayName?.split(" ")[0];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Student"
        title={firstName === undefined ? "My complaints" : `Hi ${firstName}, here are your reports`}
        description="Every issue you report appears here with its status and full history. Only you can see these."
      />
      <PageNotice searchParams={searchParams} />
      <EmptyState icon={ClipboardList} title="No complaints yet">
        Submitting a new report opens in the next release. When it does, each report will show its
        reference number, status and timeline here.
      </EmptyState>
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
