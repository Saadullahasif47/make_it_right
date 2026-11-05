import type { NextRequest } from "next/server";

import { visualAnalysisApi } from "@/features/visual-inspection/api-instance";
import { timed } from "@/lib/http/timed";

export const GET = timed(
  "GET /api/complaints/[id]/visual-analysis",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/visual-analysis">) => {
    const { id } = await context.params;
    return visualAnalysisApi.get(request, id);
  },
);
