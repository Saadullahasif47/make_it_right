import type { DeploymentEnvironment, ServerConfig } from "@/lib/config/server-config";
import { NO_STORE_HEADERS, apiErrorResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/logging/request-id";

export interface HealthBody {
  readonly status: "ok";
  /** Short commit SHA of the running deployment, or "local" outside Vercel. */
  readonly version: string;
  readonly environment: DeploymentEnvironment;
}

export interface HealthDependencies {
  readonly loadConfig: () => ServerConfig;
  readonly logger: Logger;
}

/**
 * Public liveness probe. It reports only what is safe for anyone to see: no secrets,
 * no database details (master plan §11). A misconfigured deployment answers 503.
 */
export function createHealthHandler(deps: HealthDependencies): (request: Request) => Response {
  return (request) => {
    const requestId = resolveRequestId(request.headers);

    let config: ServerConfig;
    try {
      config = deps.loadConfig();
    } catch (error) {
      deps.logger.error("health.config_invalid", { requestId, error });
      return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
    }

    const body: HealthBody = {
      status: "ok",
      version: config.deployment.commitSha?.slice(0, 7) ?? "local",
      environment: config.deployment.environment,
    };

    return Response.json(body, {
      headers: { ...NO_STORE_HEADERS, [REQUEST_ID_HEADER]: requestId },
    });
  };
}
