import { History } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { LocalTime } from "@/components/ui/local-time";
import { DepartmentToggleForm, RoutingRuleForm } from "@/features/admin/components/config-forms";
import {
  listAllDepartments,
  listConfigChanges,
  listRoutingRuleRecords,
  type ConfigChange,
  type DepartmentRecord,
} from "@/features/admin/config";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import {
  CATEGORY_LABELS,
  COMPLAINT_CATEGORIES,
  isComplaintCategory,
} from "@/features/complaints/categories";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PageNotice } from "../../_components/page-notice";

export const metadata: Metadata = { title: "Departments" };

function describeChange(change: ConfigChange, departments: readonly DepartmentRecord[]): string {
  const { detail } = change;
  switch (detail.kind) {
    case "department": {
      const name =
        departments.find((department) => department.code === detail.code)?.name ?? detail.code;
      return `${detail.isActive ? "Activated" : "Deactivated"} ${name}`;
    }
    case "routing_rule": {
      const category = isComplaintCategory(detail.category)
        ? CATEGORY_LABELS[detail.category]
        : detail.category;
      const target =
        departments.find((department) => department.id === detail.departmentId)?.name ??
        "a department";
      return `${category} routed to ${target}${detail.enabled ? "" : " (rule disabled)"}`;
    }
    case "unknown":
      return "Configuration changed";
  }
}

const headerCell = "px-4 py-2.5 text-left text-xs font-medium text-ink-muted";

async function DepartmentsAdmin({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/departments">["searchParams"];
}) {
  const access = await requirePageAccess(["admin"], "/admin/departments");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }

  const supabase = await createSupabaseServerClient();
  const [departments, rules, changes] = await Promise.all([
    listAllDepartments(supabase),
    listRoutingRuleRecords(supabase),
    listConfigChanges(supabase, 10),
  ]);
  const ruleFor = new Map(rules.map((rule) => [rule.category, rule]));
  const routedTo = (departmentId: string) =>
    rules.filter((rule) => rule.enabled && rule.departmentId === departmentId).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Departments"
        description="Who can receive tickets, and where each category is routed by default. Every change is recorded."
      />
      <PageNotice searchParams={searchParams} />

      <section aria-labelledby="availability-title" className="space-y-4">
        <h2 id="availability-title" className="text-lg font-semibold text-ink">
          Availability
        </h2>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table aria-label="Departments" className="w-full text-sm">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <th scope="col" className={headerCell}>
                  Department
                </th>
                <th scope="col" className={`${headerCell} hidden sm:table-cell`}>
                  Default for
                </th>
                <th scope="col" className={headerCell}>
                  Status
                </th>
                <th scope="col" className={`${headerCell} text-right`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {departments.map((department) => {
                const routed = routedTo(department.id);
                const routedText =
                  routed === 0
                    ? "No categories"
                    : `${routed} ${routed === 1 ? "category" : "categories"}`;
                return (
                  <tr key={department.id}>
                    <td className="px-4 py-3 align-middle">
                      <p className="font-medium text-ink">{department.name}</p>
                      <p className="mt-0.5 text-ink-muted">
                        <span className="font-mono text-xs">{department.code}</span>
                        <span className="sm:hidden"> · {routedText}</span>
                      </p>
                    </td>
                    <td className="hidden px-4 py-3 align-middle text-ink-muted sm:table-cell">
                      {routedText}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className={
                          department.isActive
                            ? "inline-flex h-6 items-center rounded-md bg-success-soft px-2 text-xs font-medium text-success"
                            : "inline-flex h-6 items-center rounded-md bg-surface-muted px-2 text-xs font-medium text-ink-muted"
                        }
                      >
                        {department.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <DepartmentToggleForm
                        departmentId={department.id}
                        name={department.name}
                        active={department.isActive}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="routing-title" className="space-y-4">
        <div>
          <h2 id="routing-title" className="text-lg font-semibold text-ink">
            Default routing
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            The AI assistant may only route a category to its enabled default department, and the
            routing form pre-selects it. A disabled rule, or one pointing at an inactive department,
            sends that category to the review queue.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-5">
          <div className="divide-y divide-line">
            {COMPLAINT_CATEGORIES.map((category) => {
              const rule = ruleFor.get(category);
              return (
                <RoutingRuleForm
                  key={category}
                  category={category}
                  label={CATEGORY_LABELS[category]}
                  departments={departments}
                  current={
                    rule === undefined
                      ? null
                      : { departmentId: rule.departmentId, enabled: rule.enabled }
                  }
                />
              );
            })}
          </div>
        </div>
      </section>

      <section aria-labelledby="changes-title" className="space-y-4">
        <h2 id="changes-title" className="text-lg font-semibold text-ink">
          Recent changes
        </h2>
        {changes.length === 0 ? (
          <EmptyState icon={History} title="No changes yet">
            Department and routing changes will be listed here with who made them.
          </EmptyState>
        ) : (
          <ol
            aria-label="Recent configuration changes"
            className="divide-y divide-line rounded-xl border border-line bg-surface"
          >
            {changes.map((change) => (
              <li
                key={change.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm"
              >
                <span className="font-medium text-ink">{describeChange(change, departments)}</span>
                <span className="text-ink-muted">
                  {change.changedByName ?? "An administrator"} ·{" "}
                  <LocalTime value={change.createdAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export default function DepartmentsPage({ searchParams }: PageProps<"/admin/departments">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DepartmentsAdmin searchParams={searchParams} />
    </Suspense>
  );
}
