import { createAdminApi } from "@/features/admin/api";
import { getSessionUser } from "@/features/auth/session";
import { timed } from "@/lib/http/timed";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const adminApi = createAdminApi({
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});

export const GET = timed("GET /api/admin/metrics", (request: Request) => adminApi.metrics(request));
