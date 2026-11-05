import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createDuplicatesApi } from "./api";

export const duplicatesApi = createDuplicatesApi({
  enabled: () => isFeatureEnabled("duplicateDetection"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
