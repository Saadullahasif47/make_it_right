import type { NextRequest } from "next/server";

import { duplicatesApi } from "@/features/duplicate-detection/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/complaints/[id]/match-review",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/match-review">) => {
    const { id } = await context.params;
    return duplicatesApi.review(request, id);
  },
);
