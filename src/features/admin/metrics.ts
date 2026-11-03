import "server-only";

import { z } from "zod";

import { complaintErrorFromDatabase } from "@/features/complaints/errors";
import type { TicketState } from "@/features/complaints/statuses";
import type { AppSupabaseClient } from "@/lib/supabase/server";

/** The windows the dashboard and the API offer (admin_metrics accepts 1-90 days). */
export const METRIC_WINDOWS = [7, 30, 90] as const;
export type MetricWindow = (typeof METRIC_WINDOWS)[number];
export const DEFAULT_WINDOW: MetricWindow = 30;

export function parseWindow(raw: string | undefined | null): MetricWindow | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_WINDOW;
  }
  const value = Number(raw);
  return METRIC_WINDOWS.find((window) => window === value);
}

const count = z.number().int().nonnegative();
const nullableNumber = z.number().nullable();

/** One count per lifecycle state; `satisfies` fails to compile if the enum gains a state. */
const statusCountsSchema = z.object({
  submitted: count,
  triaging: count,
  needs_review: count,
  assigned: count,
  in_progress: count,
  resolved: count,
  reopened: count,
  closed: count,
}) satisfies z.ZodType<Record<TicketState, number>>;

/** admin_metrics() returns jsonb; it is validated, never trusted, before anything renders it. */
const metricsSchema = z.object({
  generated_at: z.string(),
  window_days: z.number().int(),
  totals: z.object({ all: count, open: count, created_in_window: count, closed_in_window: count }),
  status_counts: statusCountsSchema,
  routing: z.object({ awaiting: count, needs_review: count, stalled_triage: count }),
  aging: z.object({
    under_1_day: count,
    one_to_3_days: count,
    three_to_7_days: count,
    over_7_days: count,
    oldest_open_hours: count,
  }),
  resolution: z.object({ resolved_in_window: count, median_hours: nullableNumber }),
  created_per_day: z.array(z.object({ day: z.string(), count })).length(14),
  departments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_active: z.boolean(),
      open: count,
      unacknowledged: count,
      in_progress: count,
      resolved_in_window: count,
    }),
  ),
  ai: z.object({
    runs: count,
    routed: count,
    needs_review: count,
    superseded: count,
    running: count,
    p50_ms: nullableNumber,
    p95_ms: nullableNumber,
    review_reasons: z.record(z.string(), count),
  }),
});

export interface DepartmentLoad {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly open: number;
  readonly unacknowledged: number;
  readonly inProgress: number;
  readonly resolvedInWindow: number;
}

export interface AdminMetrics {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly totals: {
    readonly all: number;
    readonly open: number;
    readonly createdInWindow: number;
    readonly closedInWindow: number;
  };
  readonly statusCounts: Readonly<Record<TicketState, number>>;
  readonly routing: {
    readonly awaiting: number;
    readonly needsReview: number;
    readonly stalledTriage: number;
  };
  readonly aging: {
    readonly underOneDay: number;
    readonly oneToThreeDays: number;
    readonly threeToSevenDays: number;
    readonly overSevenDays: number;
    readonly oldestOpenHours: number;
  };
  readonly resolution: { readonly resolvedInWindow: number; readonly medianHours: number | null };
  readonly createdPerDay: readonly { readonly day: string; readonly count: number }[];
  readonly departments: readonly DepartmentLoad[];
  readonly ai: {
    readonly runs: number;
    readonly routed: number;
    readonly needsReview: number;
    readonly superseded: number;
    readonly running: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly reviewReasons: Readonly<Record<string, number>>;
  };
}

function toMetrics(raw: z.infer<typeof metricsSchema>): AdminMetrics {
  return {
    generatedAt: raw.generated_at,
    windowDays: raw.window_days,
    totals: {
      all: raw.totals.all,
      open: raw.totals.open,
      createdInWindow: raw.totals.created_in_window,
      closedInWindow: raw.totals.closed_in_window,
    },
    statusCounts: raw.status_counts,
    routing: {
      awaiting: raw.routing.awaiting,
      needsReview: raw.routing.needs_review,
      stalledTriage: raw.routing.stalled_triage,
    },
    aging: {
      underOneDay: raw.aging.under_1_day,
      oneToThreeDays: raw.aging.one_to_3_days,
      threeToSevenDays: raw.aging.three_to_7_days,
      overSevenDays: raw.aging.over_7_days,
      oldestOpenHours: raw.aging.oldest_open_hours,
    },
    resolution: {
      resolvedInWindow: raw.resolution.resolved_in_window,
      medianHours: raw.resolution.median_hours,
    },
    createdPerDay: raw.created_per_day,
    departments: raw.departments.map((department) => ({
      id: department.id,
      name: department.name,
      isActive: department.is_active,
      open: department.open,
      unacknowledged: department.unacknowledged,
      inProgress: department.in_progress,
      resolvedInWindow: department.resolved_in_window,
    })),
    ai: {
      runs: raw.ai.runs,
      routed: raw.ai.routed,
      needsReview: raw.ai.needs_review,
      superseded: raw.ai.superseded,
      running: raw.ai.running,
      p50Ms: raw.ai.p50_ms,
      p95Ms: raw.ai.p95_ms,
      reviewReasons: raw.ai.review_reasons,
    },
  };
}

/** Dashboard numbers for administrators. The database refuses anyone else (MR403). */
export async function getAdminMetrics(
  client: AppSupabaseClient,
  windowDays: MetricWindow,
): Promise<AdminMetrics> {
  const { data, error } = await client.rpc("admin_metrics", { p_window_days: windowDays });
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return toMetrics(metricsSchema.parse(data));
}
