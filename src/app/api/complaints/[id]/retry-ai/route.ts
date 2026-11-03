import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/complaints/[id]/retry-ai",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/retry-ai">) => {
    const { id } = await context.params;
    return complaintsApi.retryAi(request, id);
  },
);
