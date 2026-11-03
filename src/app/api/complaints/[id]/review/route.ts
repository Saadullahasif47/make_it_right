import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/complaints/[id]/review",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/review">) => {
    const { id } = await context.params;
    return complaintsApi.review(request, id);
  },
);
