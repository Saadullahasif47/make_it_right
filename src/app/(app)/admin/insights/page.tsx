import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { LocalTime } from "@/components/ui/local-time";
import { Notice } from "@/components/ui/notice";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { RefreshAlerts } from "@/features/insights/components/insight-forms";
import { InsightsView } from "@/features/insights/components/insights-view";
import { getInsights } from "@/features/insights/queries";
import { isFeatureEnabled } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Maintenance insights" };

const NOTICES: Readonly<Record<string, string>> = {
  "alert-acknowledged": "Acknowledged. The alert stays listed until its rule no longer holds.",
  "alerts-refreshed": "Rules checked against the latest cases.",
  "target-saved": "Target saved. It applies from the next check.",
};

async function InsightsPage({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/insights">["searchParams"];
}) {
  // Access first: it reads the session, which makes the page dynamic, so the flag below is
  // read per request and never frozen into a build-time prerender.
  const access = await requirePageAccess(["admin"], "/admin/insights");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }
  if (!isFeatureEnabled("maintenanceInsights")) {
    notFound();
  }
  const rawNotice = (await searchParams).notice;
  const notice = NOTICES[Array.isArray(rawNotice) ? (rawNotice[0] ?? "") : (rawNotice ?? "")];
  const insights = await getInsights(await createSupabaseServerClient());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance insights"
        description="Historical risk indicators: repeat failures, quick reopenings, clusters and overdue work, counted by distinct case. Rules are checked daily."
        actions={<RefreshAlerts />}
      />
      {notice === undefined ? null : <Notice tone="success">{notice}</Notice>}
      <p className="text-sm text-ink-muted">
        Calculated <LocalTime value={insights.generated_at} />. These are indicators from past cases
        with demo thresholds, not a trained prediction of future failures.
      </p>
      <InsightsView insights={insights} />
    </div>
  );
}

export default function AdminInsightsPage({ searchParams }: PageProps<"/admin/insights">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InsightsPage searchParams={searchParams} />
    </Suspense>
  );
}
