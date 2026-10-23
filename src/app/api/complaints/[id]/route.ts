import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/complaints/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  return complaintsApi.detail(request, id);
}
