import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getServerConfig } from "@/lib/config";

import { authCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

export interface ProxySession {
  /** The response to continue with; it carries any refreshed auth cookies. */
  readonly response: NextResponse;
  /** True when the request carries a valid, verified session token. */
  readonly isSignedIn: boolean;
  /** Re-applies refreshed auth cookies and cache headers to a different response (e.g. a redirect). */
  readonly carryOver: (target: NextResponse) => NextResponse;
}

/**
 * Refreshes the Supabase session before any page renders (tokens are single-use, so this must
 * happen once, early). Verifying the token here is an optimisation for redirects only; pages
 * and actions still authorise against the database.
 */
export async function refreshSession(request: NextRequest): Promise<ProxySession> {
  const config = getServerConfig();
  let response = NextResponse.next({ request });
  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];
  const pendingHeaders: Record<string, string> = {};

  const client = createServerClient<Database>(config.supabase.url, config.supabase.publishableKey, {
    cookieOptions: authCookieOptions(config),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
          pendingCookies.push(cookie);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
          pendingHeaders[key] = value;
        }
      },
    },
  });

  const { data, error } = await client.auth.getClaims();
  const isSignedIn = error === null && typeof data?.claims.sub === "string";

  // Auth-dependent responses must never be shared by a CDN.
  response.headers.set("cache-control", "private, no-store");

  const carryOver = (target: NextResponse): NextResponse => {
    for (const { name, value, options } of pendingCookies) {
      target.cookies.set(name, value, options);
    }
    for (const [key, value] of Object.entries(pendingHeaders)) {
      target.headers.set(key, value);
    }
    target.headers.set("cache-control", "private, no-store");
    return target;
  };

  return { response, isSignedIn, carryOver };
}
