import type { NextRequest } from "next/server";

import { evidenceApi } from "@/features/evidence/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed(
  "POST /api/complaints/[id]/photos/finalize",
  async (request: NextRequest, context: RouteContext<"/api/complaints/[id]/photos/finalize">) => {
    const { id } = await context.params;
    return evidenceApi.finalize(request, id);
  },
);
