import { ArrowRight, Building2, GraduationCap, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { OverviewSkeleton, PageHeader, StatTile } from "@/components/layout/page-parts";
import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { MetricsDashboard, WindowFilter } from "@/features/admin/components/dashboard";
import { DEFAULT_WINDOW, getAdminMetrics, parseWindow } from "@/features/admin/metrics";
import { AccessDenied } from "@/features/auth/components/access-denied";
import type { AppRole } from "@/features/auth/roles";
import { requirePageAccess } from "@/features/auth/session";
import { createSupabaseServerClient, type AppSupabaseClient } from "@/lib/supabase/server";

import { PageNotice } from "../_components/page-notice";

export const metadata: Metadata = { title: "Admin overview" };

async function countProfiles(supabase: AppSupabaseClient, role: AppRole): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", role);
  if (error !== null) {
    throw new Error("Could not count profiles.");
  }
  return count ?? 0;
}

async function AdminOverview({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin">["searchParams"];
}) {
  const access = await requirePageAccess(["admin"], "/admin");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const rawWindow = (await searchParams).window;
  const window = parseWindow(Array.isArray(rawWindow) ? rawWindow[0] : rawWindow) ?? DEFAULT_WINDOW;
  const supabase = await createSupabaseServerClient();
  const [metrics, students, staff, admins] = await Promise.all([
    getAdminMetrics(supabase, window),
    countProfiles(supabase, "student"),
    countProfiles(supabase, "department"),
    countProfiles(supabase, "admin"),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="The live picture across campus: open work, routing, ageing tickets, departments and AI routing."
      />
      <PageNotice searchParams={searchParams} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <WindowFilter active={window} />
        <ButtonLink href="/admin/review" className="self-start sm:self-auto">
          Open review queue
          <ArrowRight aria-hidden="true" className={buttonIcon} />
        </ButtonLink>
      </div>

      <MetricsDashboard metrics={metrics} />

      <section aria-labelledby="accounts-title" className="space-y-4">
        <h2 id="accounts-title" className="text-lg font-semibold text-ink">
          Accounts
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Students" value={students} icon={GraduationCap} />
          <StatTile label="Department staff" value={staff} icon={Building2} />
          <StatTile label="Administrators" value={admins} icon={ShieldCheck} />
        </div>
      </section>
    </div>
  );
}

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <AdminOverview searchParams={searchParams} />
    </Suspense>
  );
}
