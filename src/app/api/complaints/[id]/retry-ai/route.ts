import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/complaints/[id]/retry-ai">,
): Promise<Response> {
  const { id } = await context.params;
  return complaintsApi.retryAi(request, id);
}
