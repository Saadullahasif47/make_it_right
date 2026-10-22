import { NextResponse, type NextRequest } from "next/server";

import { loginPathFor } from "@/features/auth/redirects";
import { refreshSession } from "@/lib/supabase/proxy-session";

/** Areas that always need a signed-in user. Role checks happen in the pages themselves. */
const PROTECTED_PREFIXES = ["/student", "/department", "/admin", "/account"] as const;

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Keeps the Supabase session fresh and sends obviously signed-out visitors to sign in with a
 * real redirect status. This is an optimistic check only (master plan §10): every page and
 * action authorises again against the database.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const session = await refreshSession(request);

  if (!session.isSignedIn && isProtected(request.nextUrl.pathname)) {
    const target = new URL(
      loginPathFor(`${request.nextUrl.pathname}${request.nextUrl.search}`),
      request.nextUrl.origin,
    );
    return session.carryOver(NextResponse.redirect(target, 307));
  }

  return session.response;
}

export const config = {
  // Only routes that read or change the session; the public landing page stays static.
  matcher: [
    "/student/:path*",
    "/department/:path*",
    "/admin/:path*",
    "/account/:path*",
    "/login",
    "/signup",
    "/forgot-password",
  ],
};
