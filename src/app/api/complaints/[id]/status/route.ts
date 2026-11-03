import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";
import { timed } from "@/lib/http/timed";

export const PATCH = timed(
  "PATCH /api/complaints/[id]/status",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/status">) => {
    const { id } = await context.params;
    return complaintsApi.changeStatus(request, id);
  },
);
