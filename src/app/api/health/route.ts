import { connection } from "next/server";

import { createHealthHandler } from "@/features/health/health-handler";
import { getServerConfig } from "@/lib/config";
import { createLogger } from "@/lib/logging";

const handleHealth = createHealthHandler({
  loadConfig: getServerConfig,
  // Built independently of config: this logger must work precisely when config is broken.
  logger: createLogger({ level: "warn" }),
});

export async function GET(request: Request): Promise<Response> {
  // Health must reflect the live instance, so it is never prerendered at build time.
  await connection();
  return handleHealth(request);
}
