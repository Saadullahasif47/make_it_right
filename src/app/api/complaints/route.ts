import { complaintsApi } from "@/features/complaints/api-instance";
import { timed } from "@/lib/http/timed";

export const POST = timed("POST /api/complaints", (request: Request) =>
  complaintsApi.create(request),
);

export const GET = timed("GET /api/complaints", (request: Request) => complaintsApi.list(request));
