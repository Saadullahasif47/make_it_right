import { complaintsApi } from "@/features/complaints/api-instance";

export function POST(request: Request): Promise<Response> {
  return complaintsApi.create(request);
}

export function GET(request: Request): Promise<Response> {
  return complaintsApi.list(request);
}
