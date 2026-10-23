import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createComplaintsApi } from "./api";

/** The production wiring of the complaints API, shared by its route handlers. */
export const complaintsApi = createComplaintsApi({
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
