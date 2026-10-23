import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/complaints/[id]/status">,
): Promise<Response> {
  const { id } = await context.params;
  return complaintsApi.changeStatus(request, id);
}
