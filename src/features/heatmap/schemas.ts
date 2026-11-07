import { z } from "zod";

import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";

export const HEATMAP_WINDOWS = [7, 30, 90] as const;
export const STATUS_GROUPS = ["all", "active", "done"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

const first = (value: unknown) => (Array.isArray(value) ? (value[0] as unknown) : value);

/**
 * Heatmap filters from the page's query string or the API's (plan v2 F5.04). Anything malformed
 * falls back to the default instead of failing: a stale link still shows a map.
 */
export const heatmapFiltersSchema = z.object({
  days: z.preprocess(
    first,
    z
      .enum(["7", "30", "90"])
      .catch("30")
      .transform((value) => Number(value) as (typeof HEATMAP_WINDOWS)[number]),
  ),
  building: z.preprocess(
    first,
    z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/)
      .optional()
      .catch(undefined),
  ),
  floor: z.preprocess(first, z.coerce.number().int().min(-5).max(50).optional().catch(undefined)),
  category: z.preprocess(first, z.enum(COMPLAINT_CATEGORIES).optional().catch(undefined)),
  department: z.preprocess(first, z.uuid().optional().catch(undefined)),
  status: z.preprocess(first, z.enum(STATUS_GROUPS).catch("all")),
  synthetic: z.preprocess(first, z.enum(["include", "exclude"]).catch("include")),
  room: z.preprocess(first, z.uuid().optional().catch(undefined)),
});

export type HeatmapFilters = z.infer<typeof heatmapFiltersSchema>;

const count = z.coerce.number().int().nonnegative();

export const heatmapSchema = z.object({
  window_days: z.number(),
  generated_at: z.string(),
  rooms: z.array(
    z.object({
      location_id: z.uuid(),
      building_code: z.string(),
      building_name: z.string(),
      floor: z.number(),
      room_code: z.string(),
      display_name: z.string(),
      map_x: z.number().nullable(),
      map_y: z.number().nullable(),
      cases: count,
      reports: count,
      weighted: count,
      active: count,
    }),
  ),
  unknown: z.object({ cases: count, reports: count }),
  totals: z.object({ cases: count, reports: count, synthetic_cases: count }),
});

export type Heatmap = z.infer<typeof heatmapSchema>;
export type HeatmapRoom = Heatmap["rooms"][number];

export const roomCasesSchema = z.array(
  z.object({
    case_id: z.uuid(),
    reference: z.string(),
    category: z.string(),
    priority: z.string(),
    status: z.string(),
    opened_at: z.string(),
    synthetic: z.boolean(),
    asset_code: z.string().nullable(),
    reports: count,
    complaint_id: z.uuid().nullable(),
  }),
);

export type RoomCase = z.infer<typeof roomCasesSchema>[number];

/** The query string for a filter set, so links keep the admin's current view. */
export function heatmapQuery(
  filters: HeatmapFilters,
  changes: Partial<HeatmapFilters> = {},
): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  params.set("days", String(next.days));
  if (next.building !== undefined) params.set("building", next.building);
  if (next.floor !== undefined) params.set("floor", String(next.floor));
  if (next.category !== undefined) params.set("category", next.category);
  if (next.department !== undefined) params.set("department", next.department);
  if (next.status !== "all") params.set("status", next.status);
  if (next.synthetic !== "include") params.set("synthetic", next.synthetic);
  if (next.room !== undefined) params.set("room", next.room);
  return params.toString();
}

/** Five steps of the severity-weighted count, relative to the busiest room in view. */
export function heatLevel(weighted: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (weighted <= 0 || max <= 0) return 0;
  const share = weighted / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}
