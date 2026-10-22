# Evidence: Phase 1, database and authentication

**Gate P1:** three roles sign in; unauthorized routes are denied; forbidden profile mutations are
rejected by the database.

## Task checklist (plan §15)

| ID    | Task                                                         | Status  | Evidence                                                                                 |
| ----- | ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------- |
| P1.01 | Supabase project; region, quotas; keys in Vercel preview env | Pending | `makeitright-staging` (`ijmikxhkyrensmsnmvmb`) created; Vercel env vars set by the owner |
| P1.02 | Supabase CLI; first migration and seed                       | Done    | `supabase/config.toml`, `migrations/20261022115901_identity_and_access.sql`, `seed.sql`  |
| P1.03 | departments/profiles; student-default trigger; demo seed     | Done    | `private.handle_new_user`, `scripts/seed-demo-accounts.mts`                              |
| P1.04 | SSR cookie clients and server session verification           | Done    | `lib/supabase/server.ts`, `proxy-session.ts`, `features/auth/session.ts`                 |
| P1.05 | Login/logout, callback redirects, reject signed-out access   | Done    | `(auth)` pages, `auth/confirm/route.ts`, `proxy.ts`; E2E `auth.spec.ts`                  |
| P1.06 | Role-aware navigation after server role checks               | Done    | `ROLE_NAVIGATION`, `(app)/layout.tsx`, `requirePageAccess`                               |
| P1.07 | RLS for profiles and departments; direct-client denial tests | Done    | pgTAP `002_identity_access`, `tests/integration/identity-api.test.ts`                    |
| P1.08 | Fictional student/staff/admin accounts; no self-promotion    | Done    | Seed script; 8 self-promotion attempts rejected across the pgTAP and API suites          |
| P1.09 | Auth and redirect E2E incl. expired session and wrong role   | Done    | `auth.spec.ts`: tampered cookie, cleared cookies, wrong-role 403, open-redirect          |
| P1.10 | Preview deploy; login from incognito and mobile              | Pending | After the cloud setup below                                                              |

## Local verification (2026-10-22, Docker Supabase CLI 2.121, Postgres 17)

| Suite                         | Result                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| lint / typecheck / format     | Pass                                                                |
| Unit + component (Vitest)     | **138 / 138**                                                       |
| pgTAP (`pnpm db:test`)        | **39 / 39** (10 schema-wide guarantees, 29 role-based checks)       |
| API integration (Auth + REST) | **21 / 21**                                                         |
| E2E (Playwright)              | **96 / 96** (48 journeys × desktop Chromium + Pixel 7)              |
| Production build              | Pass. Signed-in pages are Partial Prerender (static shell + stream) |

### Mutation check: do the tests catch a real hole?

`GRANT UPDATE (role, department_id) ON public.profiles TO authenticated` was applied to the live
local database. With that hole open, **6 integration tests and 6 pgTAP tests failed**,
including self-promotion to admin, joining a department and forged-claim escalation. After the
grant was revoked, both suites returned to all-green. The tests detect the regression they
exist to prevent.

## Defects found by testing and fixed in this phase

1. **`PUBLIC` could execute new functions.** A schema-scoped `ALTER DEFAULT PRIVILEGES … REVOKE
… FROM PUBLIC` cannot remove PostgreSQL's built-in global grant. The pgTAP catalog scan
   caught `private.touch_updated_at()` as executable by `anon`. Fixed with a global revoke and
   an explicit revoke per function. A regression probe now creates a fresh function and table
   in the test and asserts the API roles get nothing.
2. **`Date.now()` during runtime prerender.** Partial Prefetching prerendered session code,
   which calls the clock to check token expiry. Fixed by `connection()` in the server client:
   authorization is never prefetched or cached (ADR 0002, decision 5).
3. **The Supabase CLI could not parse a BOM-prefixed `.env.local`.** Replaced the hand-written
   file with `scripts/local-supabase-env.mts` (`pnpm db:env`), which CI also uses.
4. **Test-side issues** (fixed in the tests, not the app):
   - Next's route announcer is a second `role="alert"`, so assertions are now scoped to `<main>`.
   - A navigation raced an unfinished sign-in; the test now waits for the destination URL.
5. **Mobile account menu** hid the user's role. It now stays visible at all widths.

## Security properties demonstrated

- Signup through the real Auth API with `role: admin` in its metadata produces a `student` with
  no department.
- No role, admins included, can change `role` or `department_id` with a direct update; the
  database returns `42501`.
- Anonymous callers cannot read profiles or departments, call private helpers, or use the Auth
  admin API.
- Students and staff see only their own profile; admins see all.
- Forged JWT claims (`app_metadata.role = admin`) change nothing.
- Signed-out requests to `/student`, `/department`, `/admin` and `/account` get a 307 to
  `/login?next=…`, with `Cache-Control: no-store`.
- A wrong role gets a 403 view that reveals nothing; a `next` path in another role's area is
  ignored; `//evil.example` is never followed.
- Session cookies are `HttpOnly; SameSite=Lax` and invisible to `document.cookie`. Tampered or
  missing cookies mean signed out.
- Sign-in, sign-up and reset messages do not reveal whether an account exists.
- Password reset works end to end through the email link; the old password stops working.
- axe-core finds no WCAG 2.1 AA violations on login, sign-up, forgot-password and the student
  dashboard.

## Cloud verification

- [x] Migrations and seed applied to `makeitright-staging` with `supabase db push --include-seed`.
      `supabase migration list --linked` shows local `20261022115901` = remote `20261022115901`.
- [x] Five fictional demo accounts seeded on the cloud project by `scripts/seed-demo-accounts.mts`.
      The secret key was rotated afterwards because it had been typed on a command line.
- [ ] Vercel preview: three demo roles sign in; wrong-role and signed-out access denied
- [ ] Login checked from an incognito window and a phone
