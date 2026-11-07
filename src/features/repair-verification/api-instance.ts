import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createRepairApi } from "./api";

export const repairApi = createRepairApi({
  enabled: () => isFeatureEnabled("repairVerification"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
