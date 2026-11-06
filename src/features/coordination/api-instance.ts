import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createCoordinationApi } from "./api";

export const coordinationApi = createCoordinationApi({
  enabled: () => isFeatureEnabled("maintenanceCoordinator"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
