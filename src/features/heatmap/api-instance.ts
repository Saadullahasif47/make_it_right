import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createAnalyticsApi } from "./api";

export const analyticsApi = createAnalyticsApi({
  heatmapEnabled: () => isFeatureEnabled("campusHeatmap"),
  insightsEnabled: () => isFeatureEnabled("maintenanceInsights"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
