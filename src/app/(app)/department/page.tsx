import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PageNotice } from "../_components/page-notice";

export const metadata: Metadata = { title: "Department queue" };

async function DepartmentQueue({
  searchParams,
}: {
  readonly searchParams: PageProps<"/department">["searchParams"];
}) {
  const access = await requirePageAccess(["department"], "/department");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  let departmentName = "Your department";
  if (access.user.departmentId !== null) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("departments")
      .select("name")
      .eq("id", access.user.departmentId)
      .maybeSingle();
    departmentName = data?.name ?? departmentName;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Department queue"
        title={departmentName}
        description="Tickets assigned to your department appear here, oldest and most urgent first."
      />
      <PageNotice searchParams={searchParams} />
      <EmptyState icon={Inbox} title="Nothing assigned yet">
        When tickets are routed to {departmentName}, you will acknowledge them, add work notes and
        mark them resolved from here.
      </EmptyState>
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
