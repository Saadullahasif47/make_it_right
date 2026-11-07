import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import { LocationForm } from "./location-form";

/**
 * The room and equipment of a report's case, for staff (plan v2 F5.01, F6.01): text like
 * "Room 204" cannot always be matched, so a person picks the room, and the exact equipment.
 */
export async function CaseLocationPanel({
  client,
  complaintId,
}: {
  readonly client: AppSupabaseClient;
  readonly complaintId: string;
}) {
  const [link, rooms, assets] = await Promise.all([
    client
      .from("case_reports")
      .select(
        "case:maintenance_cases!case_reports_case_id_fkey(id, version, status, location_id, asset_id)",
      )
      .eq("complaint_id", complaintId)
      .maybeSingle(),
    client
      .from("maintenance_locations")
      .select("id, building_name, floor, room_code")
      .eq("is_active", true)
      .order("building_name")
      .order("floor")
      .order("room_code"),
    client
      .from("asset_registry")
      .select("id, asset_code, label, location:maintenance_locations(building_name, room_code)")
      .eq("is_active", true)
      .order("asset_code"),
  ]);
  if (link.error !== null || rooms.error !== null || assets.error !== null) {
    throw new Error("Could not read the case location.");
  }
  const caseRow = (
    link.data as unknown as {
      case: {
        id: string;
        version: number;
        status: string;
        location_id: string | null;
        asset_id: string | null;
      } | null;
    } | null
  )?.case;
  if (
    caseRow === undefined ||
    caseRow === null ||
    caseRow.status === "closed" ||
    caseRow.status === "merged"
  ) {
    return null;
  }

  return (
    <section
      aria-labelledby="location-title"
      className="space-y-3 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="location-title" className="text-lg font-semibold text-ink">
        Room and equipment
      </h2>
      <p className="text-sm text-ink-muted">
        {caseRow.location_id === null
          ? "This case's room is unknown, so it is not on the campus heatmap yet."
          : "Counted on the campus heatmap and in maintenance insights."}
      </p>
      <LocationForm
        complaintId={complaintId}
        caseId={caseRow.id}
        version={caseRow.version}
        locationId={caseRow.location_id}
        assetId={caseRow.asset_id}
        rooms={rooms.data.map((room) => ({
          id: room.id,
          label: `${room.room_code} (floor ${String(room.floor)})`,
          group: room.building_name,
        }))}
        assets={assets.data.map((asset) => {
          const location = asset.location as unknown as {
            building_name: string;
            room_code: string;
          } | null;
          return {
            id: asset.id,
            label: `${asset.asset_code}: ${asset.label}${location === null ? "" : ` (${location.room_code})`}`,
            group: location?.building_name ?? "Other",
          };
        })}
      />
    </section>
  );
}
