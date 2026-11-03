import { getLogger } from "@/lib/logging";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/logging/request-id";

/**
 * Wraps a route handler so every request logs one structured line with its route, status and
 * duration (plan P5.03). It records identifiers and timings only: no bodies, no complaint text.
 * The line ends up in the Vercel function logs, where endpoint timings can be compared.
 */
export function timed<Req extends Request, Args extends unknown[]>(
  route: string,
  handler: (request: Req, ...args: Args) => Promise<Response> | Response,
): (request: Req, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    const started = performance.now();
    let response: Response | undefined;
    try {
      response = await handler(request, ...args);
      return response;
    } finally {
      const status = response?.status ?? 500;
      const fields = {
        requestId: response?.headers.get(REQUEST_ID_HEADER) ?? resolveRequestId(request.headers),
        route,
        status,
        durationMs: Math.round(performance.now() - started),
      };
      const logger = getLogger();
      if (status >= 500) {
        logger.error("http.request", fields);
      } else {
        logger.info("http.request", fields);
      }
    }
  };
}
