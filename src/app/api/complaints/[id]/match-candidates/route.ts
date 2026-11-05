import type { NextRequest } from "next/server";

import { duplicatesApi } from "@/features/duplicate-detection/api-instance";
import { timed } from "@/lib/http/timed";

export const GET = timed(
  "GET /api/complaints/[id]/match-candidates",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/match-candidates">) => {
    const { id } = await context.params;
    return duplicatesApi.candidates(request, id);
  },
);
