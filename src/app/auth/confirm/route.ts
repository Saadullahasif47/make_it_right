import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { ROLE_HOME_PATHS, isAppRole } from "@/features/auth/roles";
import { getLogger } from "@/lib/logging";
import { resolveRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ACCEPTED_OTP_TYPES: readonly EmailOtpType[] = ["email", "signup", "recovery", "invite"];
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

function isAcceptedType(value: string | null): value is EmailOtpType {
  return value !== null && (ACCEPTED_OTP_TYPES as readonly string[]).includes(value);
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

/**
 * Landing point for links in confirmation and password-reset emails. Supports the token-hash
 * link (works on any device) and, for providers' default templates, the PKCE `code` exchange.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const supabase = await createSupabaseServerClient();

  let verifiedType: EmailOtpType | "code";
  let errorCode: string | undefined;

  if (tokenHash !== null && TOKEN_HASH_PATTERN.test(tokenHash) && isAcceptedType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verifiedType = type;
    errorCode = error?.code ?? (error === null ? undefined : "verify_failed");
  } else if (code !== null && code.length <= 200) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verifiedType = "code";
    errorCode = error?.code ?? (error === null ? undefined : "exchange_failed");
  } else {
    return redirectTo(request, "/login?notice=link-invalid");
  }

  if (errorCode !== undefined) {
    getLogger().warn("auth.link_rejected", {
      requestId: resolveRequestId(request.headers),
      type: verifiedType,
      code: errorCode,
    });
    return redirectTo(request, "/login?notice=link-invalid");
  }

  if (verifiedType === "recovery") {
    return redirectTo(request, "/account/password");
  }

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (typeof userId !== "string") {
    return redirectTo(request, "/login?notice=link-invalid");
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  return redirectTo(
    request,
    profile !== null && isAppRole(profile.role) ? ROLE_HOME_PATHS[profile.role] : "/login",
  );
}
