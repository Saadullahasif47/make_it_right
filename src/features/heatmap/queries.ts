import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import {
  heatmapSchema,
  roomCasesSchema,
  type Heatmap,
  type HeatmapFilters,
  type RoomCase,
} from "./schemas";

export class HeatmapError extends Error {
  override readonly name = "HeatmapError";
  readonly code: "FORBIDDEN" | "VALIDATION_FAILED" | "SERVICE_UNAVAILABLE";

  constructor(sqlState: string | undefined, options?: ErrorOptions) {
    const code =
      sqlState === "MR403"
        ? "FORBIDDEN"
        : sqlState === "22023"
          ? "VALIDATION_FAILED"
          : "SERVICE_UNAVAILABLE";
    super(code, options);
    this.code = code;
  }
}

/**
 * Cases per room for the filters (plan v2 F5.02). The database counts distinct cases, so linked
 * duplicate reports never inflate a room; report counts come alongside for transparency.
 */
export async function getHeatmap(
  client: AppSupabaseClient,
  filters: HeatmapFilters,
): Promise<Heatmap> {
  const { data, error } = await client.rpc("admin_heatmap", {
    p_days: filters.days,
    p_status: filters.status,
    p_include_synthetic: filters.synthetic === "include",
    ...(filters.building === undefined ? {} : { p_building: filters.building }),
    ...(filters.floor === undefined ? {} : { p_floor: filters.floor }),
    ...(filters.category === undefined ? {} : { p_category: filters.category }),
    ...(filters.department === undefined ? {} : { p_department: filters.department }),
  });
  if (error !== null) throw new HeatmapError(error.code, { cause: error });
  return heatmapSchema.parse(data);
}

/** The cases behind one room, newest first (drilldown, F5.04). */
export async function getRoomCases(
  client: AppSupabaseClient,
  locationId: string,
  filters: HeatmapFilters,
): Promise<readonly RoomCase[]> {
  const { data, error } = await client.rpc("admin_heatmap_room", {
    p_location_id: locationId,
    p_days: filters.days,
    p_status: filters.status,
    p_include_synthetic: filters.synthetic === "include",
    ...(filters.category === undefined ? {} : { p_category: filters.category }),
    ...(filters.department === undefined ? {} : { p_department: filters.department }),
  });
  if (error !== null) throw new HeatmapError(error.code, { cause: error });
  return roomCasesSchema.parse(data);
}
