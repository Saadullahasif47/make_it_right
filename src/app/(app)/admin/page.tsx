import { ArrowRight, Building2, GraduationCap, ListChecks, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton, StatTile } from "@/components/layout/page-parts";
import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { AccessDenied } from "@/features/auth/components/access-denied";
import type { AppRole } from "@/features/auth/roles";
import { requirePageAccess } from "@/features/auth/session";
import { AWAITING_ROUTING_STATES } from "@/features/complaints/workflow";
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

  const supabase = await createSupabaseServerClient();
  const [students, staff, admins, departments, awaiting] = await Promise.all([
    countProfiles(supabase, "student"),
    countProfiles(supabase, "department"),
    countProfiles(supabase, "admin"),
    supabase.from("departments").select("id, code, name, is_active").order("name"),
    supabase
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .in("status", [...AWAITING_ROUTING_STATES]),
  ]);
  if (departments.error !== null || awaiting.error !== null) {
    throw new Error("Could not load the overview.");
  }
  const awaitingCount = awaiting.count ?? 0;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Administrator"
        title="Overview"
        description="Tickets waiting for routing, accounts and departments across the campus."
      />
      <PageNotice searchParams={searchParams} />

      <section
        aria-labelledby="routing-title"
        className="flex flex-col gap-4 rounded-2xl border border-brand/30 bg-surface p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
            <ListChecks aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 id="routing-title" className="text-lg font-bold text-ink">
              Awaiting routing
            </h2>
            <p className="text-sm text-ink-muted">
              <span className="text-2xl font-extrabold text-ink tabular-nums">{awaitingCount}</span>{" "}
              {awaitingCount === 1 ? "ticket needs" : "tickets need"} a department.
            </p>
          </div>
        </div>
        <ButtonLink href="/admin/review" className="self-start sm:self-auto">
          Open review queue
          <ArrowRight aria-hidden="true" className={buttonIconSlide} />
        </ButtonLink>
      </section>

      <section aria-labelledby="accounts-title" className="space-y-4">
        <h2 id="accounts-title" className="text-lg font-bold text-ink">
          Accounts
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Students" value={students} icon={GraduationCap} />
          <StatTile label="Department staff" value={staff} icon={Building2} />
          <StatTile label="Administrators" value={admins} icon={ShieldCheck} />
        </div>
      </section>

      <section aria-labelledby="departments-title" className="space-y-4">
        <h2 id="departments-title" className="text-lg font-bold text-ink">
          Departments
        </h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-ink-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="hidden px-5 py-3 font-semibold sm:table-cell">
                  Code
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {departments.data.map((department) => (
                <tr key={department.id} className="transition-colors duration-200 hover:bg-canvas">
                  <td className="px-5 py-3.5 font-medium text-ink">{department.name}</td>
                  <td className="hidden px-5 py-3.5 font-mono text-xs text-ink-muted sm:table-cell">
                    {department.code}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={
                        department.is_active
                          ? "inline-flex rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success"
                          : "inline-flex rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-ink-muted"
                      }
                    >
                      {department.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminOverview searchParams={searchParams} />
    </Suspense>
  );
}
