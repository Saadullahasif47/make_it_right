import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";
import { timed } from "@/lib/http/timed";

export const GET = timed(
  "GET /api/complaints/[id]",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]">) => {
    const { id } = await context.params;
    return complaintsApi.detail(request, id);
  },
);
