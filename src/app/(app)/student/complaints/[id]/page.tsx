import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintDetailView } from "@/features/complaints/components/complaint-detail-view";
import { WorkflowPanel } from "@/features/complaints/components/workflow-panel";
import { WORKFLOW_NOTICES } from "@/features/complaints/paths";
import { getComplaint } from "@/features/complaints/repository";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complaint" };

const SUBMISSION_NOTICES: Readonly<Record<string, string>> = {
  created: "Your report has been saved. We will route it to the right department.",
  "created-routed": "Your report has been saved and sent to the department that handles it.",
  "already-submitted": "This report was already saved, so we did not create a duplicate.",
};

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
  const key = Array.isArray(rawNotice) ? (rawNotice[0] ?? "") : (rawNotice ?? "");
  const submission = SUBMISSION_NOTICES[key];
  const workflow = WORKFLOW_NOTICES[key];

  return (
    <ComplaintDetailView
      complaint={complaint}
      back={{ href: "/student/complaints", label: "My complaints" }}
      notice={
        submission !== undefined ? (
          <>
            {submission} Your reference is{" "}
            <strong className="font-mono whitespace-nowrap">{complaint.reference}</strong>.
          </>
        ) : (
          workflow
        )
      }
      actions={
        <WorkflowPanel
          ticketId={complaint.id}
          version={complaint.version}
          status={complaint.status}
          acknowledgedAt={complaint.acknowledgedAt}
          role={access.user.role}
        />
      }
    />
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
