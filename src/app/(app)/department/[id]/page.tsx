import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { TicketSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { ComplaintDetailView } from "@/features/complaints/components/complaint-detail-view";
import { WorkflowPanel } from "@/features/complaints/components/workflow-panel";
import { WORKFLOW_NOTICES } from "@/features/complaints/paths";
import { getComplaint } from "@/features/complaints/repository";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { CoordinationPanel } from "@/features/coordination/components/coordination-panel";
import { DuplicatesPanel } from "@/features/duplicate-detection/components/duplicates-panel";
import { PhotoEvidence } from "@/features/evidence/components/photo-evidence";
import { CaseLocationPanel } from "@/features/heatmap/components/case-location-panel";
import { RepairVerificationPanel } from "@/features/repair-verification/components/repair-verification-panel";
import { isFeatureEnabled } from "@/lib/config";
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
  const client = await createSupabaseServerClient();
  // RLS hides tickets of other departments: indistinguishable from a missing ticket.
  const complaint = parsedId.success ? await getComplaint(client, parsedId.data) : null;
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
      toast={notice}
      actions={
        <>
          <WorkflowPanel
            ticketId={complaint.id}
            version={complaint.version}
            status={complaint.status}
            acknowledgedAt={complaint.acknowledgedAt}
            role={access.user.role}
          />
          {isFeatureEnabled("repairVerification") ? (
            <RepairVerificationPanel client={client} complaintId={complaint.id} viewer="staff" />
          ) : null}
          {isFeatureEnabled("maintenanceCoordinator") ? (
            <CoordinationPanel client={client} complaintId={complaint.id} viewer="staff" />
          ) : null}
          {isFeatureEnabled("duplicateDetection") ? (
            <DuplicatesPanel
              client={client}
              complaintId={complaint.id}
              viewer="staff"
              hrefFor={(id) => `/department/${id}`}
            />
          ) : null}
          {isFeatureEnabled("campusHeatmap") || isFeatureEnabled("maintenanceInsights") ? (
            <CaseLocationPanel client={client} complaintId={complaint.id} />
          ) : null}
          {isFeatureEnabled("visualInspection") ? (
            <PhotoEvidence client={client} complaintId={complaint.id} viewer="staff" open={false} />
          ) : null}
        </>
      }
    />
  );
}

export default function DepartmentTicketPage({
  params,
  searchParams,
}: PageProps<"/department/[id]">) {
  return (
    <Suspense fallback={<TicketSkeleton />}>
      <DepartmentTicket params={params} searchParams={searchParams} />
    </Suspense>
  );
}
