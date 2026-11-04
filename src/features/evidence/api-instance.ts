import "server-only";

import { getSessionUser } from "@/features/auth/session";
import { isFeatureEnabled } from "@/lib/config";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createEvidenceApi } from "./api";

/** The production wiring of the photo evidence endpoints (plan v2 F1.02). */
export const evidenceApi = createEvidenceApi({
  enabled: () => isFeatureEnabled("visualInspection"),
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
});
