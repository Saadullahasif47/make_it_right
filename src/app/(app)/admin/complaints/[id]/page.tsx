import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { AssignForm } from "@/features/complaints/components/assign-form";
import { ComplaintDetailView } from "@/features/complaints/components/complaint-detail-view";
import { WorkflowPanel } from "@/features/complaints/components/workflow-panel";
import { WORKFLOW_NOTICES } from "@/features/complaints/paths";
import {
  getComplaint,
  listActiveDepartments,
  listRoutingRules,
} from "@/features/complaints/repository";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { canAssign } from "@/features/complaints/workflow";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ticket" };

async function AdminTicket({
  params,
  searchParams,
}: {
  readonly params: PageProps<"/admin/complaints/[id]">["params"];
  readonly searchParams: PageProps<"/admin/complaints/[id]">["searchParams"];
}) {
  const { id } = await params;
  const access = await requirePageAccess(["admin"], `/admin/complaints/${id}`);
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const parsedId = complaintIdSchema.safeParse(id);
  if (!parsedId.success) {
    notFound();
  }
  const supabase = await createSupabaseServerClient();
  const [complaint, departments, routingRules] = await Promise.all([
    getComplaint(supabase, parsedId.data),
    listActiveDepartments(supabase),
    listRoutingRules(supabase),
  ]);
  if (complaint === null) {
    notFound();
  }

  const rawNotice = (await searchParams).notice;
  const notice =
    WORKFLOW_NOTICES[Array.isArray(rawNotice) ? (rawNotice[0] ?? "") : (rawNotice ?? "")];

  return (
    <ComplaintDetailView
      complaint={complaint}
      back={{ href: "/admin/review", label: "Review queue" }}
      notice={notice}
      actions={
        <>
          {canAssign(complaint.status, access.user.role) ? (
            <AssignForm
              ticketId={complaint.id}
              version={complaint.version}
              departments={departments}
              routingRules={routingRules}
              current={{
                category: complaint.category,
                priority: complaint.priority,
                departmentId: complaint.assignedDepartmentId,
              }}
            />
          ) : null}
          <WorkflowPanel
            ticketId={complaint.id}
            version={complaint.version}
            status={complaint.status}
            acknowledgedAt={complaint.acknowledgedAt}
            role={access.user.role}
          />
        </>
      }
    />
  );
}

export default function AdminTicketPage({
  params,
  searchParams,
}: PageProps<"/admin/complaints/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminTicket params={params} searchParams={searchParams} />
    </Suspense>
  );
}
