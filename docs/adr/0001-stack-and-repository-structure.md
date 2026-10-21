# ADR 0001: Stack and repository structure

- **Status:** Accepted
- **Date:** 2026-10-22
- **Phase:** P0

## Source of truth

The _CampusFix Implementation Master Plan v1.0_ (21 Oct 2026) is the specification. The product
is named **MakeItRight: AI Cloud-Based University Complaint System**. "CampusFix" in the plan
refers to this project.

## Decisions

1. **One Next.js App Router monolith on Vercel.** Pages and API route handlers ship as one
   deployable, with no separate backend (plan §3).
2. **The app lives at the repository root**, not in a `campusfix/` subfolder, so Vercel and CI
   need no root-directory configuration.
3. **Next.js 16 defaults are kept: Cache Components and Partial Prefetching.** Routes are
   dynamic only when they read request data. `/api/health` calls `connection()` so it is never
   prerendered.
4. **Strict tooling.** On top of `strict`, TypeScript also enables `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noImplicitReturns` and `verbatimModuleSyntax`. ESLint uses
   `typescript-eslint` `strictTypeChecked` and adds `no-floating-promises` (plan §13 rule 16), a
   ban on `process.env` outside `src/lib/config` (rule 14), and a rule that every suppression
   needs a written reason.
5. **Configuration** is parsed once by a Zod schema in `src/lib/config`. Instrumentation
   validates it at boot. Empty strings count as unset. AI is on only when `AI_ENABLED=true`
   **and** a key exists. Each variable is added to the schema in the phase that first reads it.
6. **Logging** goes through a structured JSON-lines logger. It redacts credential, identity and
   complaint-content keys at any depth and never writes stack traces. A client-supplied
   `x-request-id` is reused only when it matches `req_[A-Za-z0-9]{16,64}`, which prevents log
   injection.
7. **API errors** come from one catalog (`src/lib/http/api-error.ts`) that implements the §11
   error body `{ error: { code, message, requestId } }`.
8. **Dependencies are added in the phase that first uses them.** Supabase packages arrive in
   P1 and `@google/genai` in P4. That keeps every lockfile entry exercised.
9. **CI** runs one job: lint, typecheck, format, unit tests, `pnpm audit` (high or above fails),
   build, then Playwright on desktop and mobile Chromium. Actions are pinned to commit SHAs and
   the workflow token is read-only.

## UI direction

The palette is deep ink (#0B1F2A, for trust and legibility), pine teal (#0B7A6E, for
resolution) and amber (#F2A516, for attention, used sparingly), on a cool off-white canvas. A
matching dark theme follows `prefers-color-scheme`. Every text and background token pair is at
least 4.5:1 (WCAG AA), and Playwright runs axe-core against both themes.

Motion is limited to entrance animations on load, hover and press micro-interactions on buttons
and cards, and a pulsing timeline state. All of it is disabled under `prefers-reduced-motion`.
Scroll-driven reveal was tried and **rejected**: it leaves off-screen content invisible to
full-page screenshots and print, which the plan relies on for evidence. A regression test now
enforces this.

## Deferred

- A nonce-based Content-Security-Policy, added once auth pages and scripts exist (P1/P5).
- Branch protection: GitHub does not offer it for private repositories on the free plan. The
  substitute is merging through pull requests only, with CI required to pass.
