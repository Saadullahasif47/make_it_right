# ADR 0007: Production release, demo data and release checks

- **Status:** Accepted
- **Date:** 2026-11-03
- **Phase:** P7

## Context

Plan §15 (P7.01–P7.09) asks for production deployment with fresh fictional demo data, a final
smoke test, cloud evidence, a rehearsed demo, rollback steps and a code freeze. ADR 0002 left one
question open for this phase: whether production moves to a Supabase project of its own.

**Gate P7:** the live Vercel link works; the full demo passes; cloud evidence, runbook, source and
evaluation are delivered.

## Decisions

1. **The existing cloud project is production.** `makeitright-staging` stays the only Supabase
   project.
   - The free plan allows two active projects per account, and the owner's second slot is
     taken by another project.
   - A paid plan is out of scope (release gate: "no paid tier activated inadvertently").
   - The ADR 0002 safeguards remain:
     - only fictional data;
     - no automated test writes to it;
     - only reviewed, additive migrations.
   - Its name is kept, because renaming the project changes nothing technical.
   - Moving to a dedicated project later is still a matter of applying the migrations and
     changing two Vercel variables.
2. **Demo data goes through the application's own rules.** `supabase/demo/demo-tickets.sql`
   impersonates each demo account exactly as the Data API does, and calls the same audited
   functions the app calls (`create_ticket`, `assign_ticket`, `acknowledge_ticket`,
   `transition_ticket`).
   - The 12 tickets therefore have real timelines and respect every rule: transitions, roles,
     notes and versions.
   - No rows are inserted by hand.
   - Fixed idempotency keys make the script safe to re-run.
   - The tickets carry today's timestamps, not invented history, so the dashboard shows only
     what really happened.
3. **The release smoke test is read-only.** `scripts/smoke.mts` (`pnpm smoke`) checks that:
   - the deployed commit equals the expected commit;
   - public pages render with the security headers;
   - every signed-in area redirects visitors to sign in;
   - every API refuses anonymous callers;
   - a cross-site submission is refused.

   It signs nobody in and writes nothing, so it can run against production at any time.

   The signed-in journeys are covered by the E2E suite on every PR and by the rehearsed demo.

4. **Rollback is by layer, smallest step first.**
   - The AI kill switch (`AI_ENABLED=false`).
   - Vercel Instant Rollback for a bad build.
   - The audited admin pages for configuration.
   - Forward-only corrective migrations for the schema.
   - Details are in [runbooks/release.md](../runbooks/release.md).
5. **The submission is frozen with a tag** (`v1.0.0`). After the tag, only rehearsal defects are
   fixed, each through a PR with green CI.

## Consequences

- Previews and production share data. A preview can show production's fictional tickets, which
  is acceptable for a prototype with fictional data, and is listed as a known limitation.
- The built-in email sender allows only a few emails per hour, so expo visitors use the seeded
  demo accounts instead of signing up.
- The demo password was shared in a chat during development. Rotating it before the expo, with
  `scripts/seed-demo-accounts.mts` from the owner's machine, is on the demo day checklist.
