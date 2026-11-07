import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/layout/page-parts";
import { LocalTime } from "@/components/ui/local-time";
import { AccessDenied } from "@/features/auth/components/access-denied";
import { requirePageAccess } from "@/features/auth/session";
import { listActiveDepartments } from "@/features/complaints/repository";
import { CampusHeatmap, RoomCases } from "@/features/heatmap/components/campus-heatmap";
import { HeatmapFiltersForm } from "@/features/heatmap/components/heatmap-filters";
import { getHeatmap, getRoomCases } from "@/features/heatmap/queries";
import { heatmapFiltersSchema } from "@/features/heatmap/schemas";
import { isFeatureEnabled } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campus heatmap" };

async function HeatmapPage({
  searchParams,
}: {
  readonly searchParams: PageProps<"/admin/heatmap">["searchParams"];
}) {
  // Access first: it reads the session, which makes the page dynamic, so the flag below is
  // read per request and never frozen into a build-time prerender.
  const access = await requirePageAccess(["admin"], "/admin/heatmap");
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }
  if (!isFeatureEnabled("campusHeatmap")) {
    notFound();
  }

  const filters = heatmapFiltersSchema.parse(await searchParams);
  const client = await createSupabaseServerClient();
  const [heatmap, departments, places, roomCases] = await Promise.all([
    getHeatmap(client, filters),
    listActiveDepartments(client),
    client
      .from("maintenance_locations")
      .select("building_code, building_name, floor")
      .eq("is_active", true),
    filters.room === undefined ? Promise.resolve([]) : getRoomCases(client, filters.room, filters),
  ]);
  if (places.error !== null) {
    throw new Error("Could not read campus locations.");
  }
  const buildings = [
    ...new Map(places.data.map((row) => [row.building_code, row.building_name])).entries(),
  ]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const floors = [...new Set(places.data.map((row) => row.floor))].sort((a, b) => a - b);
  const room = heatmap.rooms.find((entry) => entry.location_id === filters.room);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campus heatmap"
        description="Where maintenance problems are, by building, floor and room. Counts are distinct cases, so several reports of one problem count once."
      />
      <HeatmapFiltersForm
        filters={filters}
        buildings={buildings}
        floors={floors}
        departments={departments}
      />
      <p className="text-sm text-ink-muted">
        <strong className="font-semibold text-ink">{heatmap.totals.cases}</strong> cases opened in
        the last {heatmap.window_days} days, with {heatmap.totals.reports} reports linked to them
        {heatmap.totals.synthetic_cases > 0
          ? ` (${String(heatmap.totals.synthetic_cases)} are labelled demo cases, which have no reports)`
          : ""}
        . Calculated <LocalTime value={heatmap.generated_at} />.
      </p>
      <CampusHeatmap heatmap={heatmap} filters={filters} />
      {filters.room === undefined ? null : <RoomCases room={room} cases={roomCases} />}
    </div>
  );
}

export default function AdminHeatmapPage({ searchParams }: PageProps<"/admin/heatmap">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HeatmapPage searchParams={searchParams} />
    </Suspense>
  );
}
