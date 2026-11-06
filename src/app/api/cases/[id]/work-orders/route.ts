import type { NextRequest } from "next/server";

import { coordinationApi } from "@/features/coordination/api-instance";
import { timed } from "@/lib/http/timed";

export const GET = timed(
  "GET /api/cases/[id]/work-orders",
  async (request: NextRequest, context: RouteContext<"/api/cases/[id]/work-orders">) => {
    const { id } = await context.params;
    return coordinationApi.workOrders(request, id);
  },
);
