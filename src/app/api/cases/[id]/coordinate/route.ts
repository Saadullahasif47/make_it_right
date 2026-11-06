import type { NextRequest } from "next/server";

import { coordinationApi } from "@/features/coordination/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/cases/[id]/coordinate",
  async (request: NextRequest, context: RouteContext<"/api/cases/[id]/coordinate">) => {
    const { id } = await context.params;
    return coordinationApi.coordinate(request, id);
  },
);
