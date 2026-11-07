import type { NextRequest } from "next/server";

import { repairApi } from "@/features/repair-verification/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/cases/[id]/verification-decision",
  async (request: NextRequest, context: RouteContext<"/api/cases/[id]/verification-decision">) => {
    const { id } = await context.params;
    return repairApi.decide(request, id);
  },
);
