import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createVisualAnalysisApi } from "./api";

export const visualAnalysisApi = createVisualAnalysisApi({
  enabled: () => isFeatureEnabled("visualInspection"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
