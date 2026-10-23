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

export const metadata: Metadata = { title: "Ticket" };

async function DepartmentTicket({
  params,
  searchParams,
}: {
  readonly params: PageProps<"/department/[id]">["params"];
  readonly searchParams: PageProps<"/department/[id]">["searchParams"];
}) {
  const { id } = await params;
  const access = await requirePageAccess(["department"], `/department/${id}`);
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const parsedId = complaintIdSchema.safeParse(id);
  // RLS hides tickets of other departments: indistinguishable from a missing ticket.
  const complaint = parsedId.success
    ? await getComplaint(await createSupabaseServerClient(), parsedId.data)
    : null;
  if (complaint === null) {
    notFound();
  }

  const rawNotice = (await searchParams).notice;
  const notice =
    WORKFLOW_NOTICES[Array.isArray(rawNotice) ? (rawNotice[0] ?? "") : (rawNotice ?? "")];

  return (
    <ComplaintDetailView
      complaint={complaint}
      back={{ href: "/department", label: "Department queue" }}
      notice={notice}
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

export default function DepartmentTicketPage({
  params,
  searchParams,
}: PageProps<"/department/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DepartmentTicket params={params} searchParams={searchParams} />
    </Suspense>
  );
}
