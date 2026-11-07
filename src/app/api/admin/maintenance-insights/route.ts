import { analyticsApi } from "@/features/heatmap/api-instance";
import { timed } from "@/lib/http/timed";

export const GET = timed("GET /api/admin/maintenance-insights", (request: Request) =>
  analyticsApi.insights(request),
);
