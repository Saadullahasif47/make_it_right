import type { NextRequest } from "next/server";

import { complaintsApi } from "@/features/complaints/api-instance";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/complaints/[id]/review">,
): Promise<Response> {
  const { id } = await context.params;
  return complaintsApi.review(request, id);
}
