# ADR 0002: Identity, access control and Supabase environments

- **Status:** Accepted
- **Date:** 2026-10-22
- **Phase:** P1

## Context

Master plan §5 and §10 require three roles, signup that always produces a student, role
changes only through privileged operations, and authorization enforced by both the database
and the server. §18 asks for separate preview and production databases "if possible".

## Decisions

### Database is the source of truth for authority

1. **Secure-by-default privileges.** The first migration revokes Supabase's default grants to
   `anon` and `authenticated` on new tables and functions in `public`. It also revokes the
   built-in global `EXECUTE` grant to `PUBLIC` for functions created by the migration role.
   - A schema-scoped `REVOKE` cannot remove that global grant. pgTAP caught exactly this gap.
   - Every later table and function must grant access explicitly.
   - Regression probes in `001_schema_guarantees.test.sql` fail if a new object starts open.
2. **`profiles.role` is never client-controlled.**
   - The signup trigger inserts only `id` and a sanitised `display_name`, so the role
     defaults to `student`. Roles in user metadata are ignored.
   - A column-level `GRANT UPDATE (display_name)` makes any attempt to change `role` or
     `department_id` a permission error (`42501`). This applies to every user, admins
     included; role changes need a dedicated privileged operation.
   - The `profiles_department_matches_role` check ties `department_id` to `role = 'department'`.
3. **Policy helpers live in `private`.** That schema is not exposed by the Data API. The helpers
   are `SECURITY DEFINER` with a pinned `search_path`, and they describe only `auth.uid()`.
   Forged JWT claims (`app_metadata.role`) confer nothing, and tests prove it.

### Server-side checks

4. **The data access layer** (`features/auth/session.ts`) verifies the token with
   `getClaims()`, then reads the role from `profiles` on every request.
   - Pages call `requirePageAccess(roles, path)`. Layouts never authorize, because App Router
     renders layouts and pages in parallel.
   - `proxy.ts` only refreshes the session and redirects signed-out visitors (307) as an
     optimisation.
5. **Session work is never prerendered or prefetched.** `createSupabaseServerClient()` calls
   `connection()`, accepting slower navigation in exchange for never serving a stale
   authorized view. This also removed runtime-prefetch `Date.now()` errors.
6. **Auth cookies are `HttpOnly; SameSite=Lax`.** No browser Supabase client exists, so
   injected script cannot read session tokens.
7. **No account enumeration.** Sign-in failures share one message. Sign-up and password reset
   always answer "if this address…". Only stable error codes are logged, never emails.
8. **Email links use `token_hash`** (`/auth/confirm`), so they work on a different device from
   the one that requested them. A PKCE `code` fallback covers Supabase's default templates.
9. **Open redirects are blocked.** `toSafeInternalPath` rejects off-site, protocol-relative,
   backslash and control-character paths. A `next` path in another role's area is ignored.

### Environments

10. **Local development and CI use the Supabase CLI stack in Docker.** All pgTAP, integration
    and E2E tests run there; CI needs no cloud credentials. Tests that create accounts refuse to
    run against a non-local Supabase URL.
11. **One cloud project for now.** The Supabase free plan allows two active projects per
    account, and the owner's second slot is in use. So `makeitright-staging`
    (`ijmikxhkyrensmsnmvmb`) serves both Vercel previews and production until Phase 7.
    Safeguards:
    - no automated test writes to it
    - migrations are applied to it only after review, and only additive ones
    - previews hold fictional data only
    - the demo dataset is reset from the seed before the final demo

    Moving production to its own project means applying the migrations and changing two Vercel
    variables.

12. **Demo accounts** are created by `scripts/seed-demo-accounts.mts` with the secret key, and
    their password comes from `DEMO_ACCOUNT_PASSWORD` at run time. No password is committed
    (plan §13 rule 15).

## Consequences

- Admins can read every profile but cannot yet change roles from the app. A privileged,
  audited role-management operation is added with the admin pages (plan P3.03/P5).
- The free cloud project sends at most a few auth emails per hour with the built-in SMTP.
  Seeded demo accounts are pre-confirmed, so demos do not depend on email.
