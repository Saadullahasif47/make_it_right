# Evidence: Phase 5, dashboard and operations

**Gate P5:** the admin sees accurate aggregates, bad requests visibly fail, and media files (if
enabled) are private.

## Task checklist (plan §15)

| ID    | Task                                                           | Status   | Evidence                                                                       |
| ----- | -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| P5.01 | Administrator metrics queries, limited pagination and filters  | Done     | `admin_metrics()` (window 1–90 days); `GET /api/admin/metrics`; 7/30/90 filter |
| P5.02 | Structured request-id logging and error-boundary UI            | Done     | Request ids on every API response and log line (P0–P4); route error boundary   |
| P5.03 | Endpoint timings in Vercel logs, without raw complaint text    | Done     | `timed()` on every API route: `http.request` with route, status, duration      |
| P5.04 | Optional: private evidence bucket                              | Deferred | Optional in the plan; deferred until after the expo (ADR 0006)                 |
| P5.05 | Optional: secure image upload and permission-checked retrieval | Deferred | As above                                                                       |
| P5.06 | Admin review, status distribution and ageing views             | Done     | Dashboard on `/admin`; review queue (P3/P4); department workload               |
| P5.07 | Free-quota checklist and warning thresholds                    | Done     | [free-tier-quotas.md](../runbooks/free-tier-quotas.md)                         |
| P5.08 | Accessibility and mobile pass; empty and error states          | Done     | axe on `/admin` and `/admin/departments` (desktop + Pixel 7); empty states     |

Also built: `/admin/departments` (plan §7) for department availability and default routing,
through two audited admin-only functions with an append-only change log.

## Local verification (2026-11-03)

| Suite                         | Result                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| lint / typecheck / format     | Pass                                                        |
| Unit + component (Vitest)     | **382 / 382** (21 new: metrics API, window parsing, timing) |
| pgTAP (`pnpm db:test`)        | **222 / 222** (44 new admin operations assertions)          |
| API integration (Auth + REST) | **80 / 80** (7 new, over the real Data API)                 |
| E2E (Playwright)              | **151 passed**, 1 skipped by design, axe clean              |
| Production build              | Pass, from a clean `.next`                                  |

### Gate P5 criteria, as tested

- **Accurate aggregates:**
  - pgTAP measures every section as a delta against a snapshot taken before its fixtures, so
    other data cannot hide an error. Checked: totals, all eight status counts, routing backlog,
    stalled AI attempts, ageing buckets, resolution count and median, the 14-day series, per
    department open, new and resolved work, AI runs by outcome, and review reasons by code.
  - E2E creates a department of its own with two tickets (one acknowledged), and the dashboard
    row shows exactly 2 open, 1 new, 0 in progress, 0 resolved.
- **Bad requests visibly fail:**
  - API: 401 when signed out, 403 for non-admins, 400 for an unsupported window with a field
    message, and a safe 503 for a malformed payload.
  - Database: `MR403` for non-admins, `22023` for a bad window, `MR304` for no-op changes.
  - UI: an enabled rule pointing at an inactive department shows an alert and changes nothing.
    A no-op change shows "Nothing changed". Non-admins see the 403 page.
- **Media is private:** not applicable. Photo evidence is deferred (ADR 0006), so no media exists.

## Mutation checks

| Fault deliberately introduced                               | Detected by                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `admin_metrics` without its administrator check             | pgTAP 006 (2 failures); integration (2 failures)                    |
| Direct `UPDATE` on `departments` granted to signed-in users | pgTAP 002 and 006 (1 failure each); integration (direct-write test) |

Both faults were reverted with `supabase db reset` and the suites re-run green.

## Defects found by testing and fixed in this phase

1. **A scrollable region keyboard users could not reach.** On a phone, the department workload
   table is wider than the screen. axe flagged `scrollable-region-focusable` on mobile, in 3 of 4
   runs depending on layout timing. The region is now labelled and focusable.
2. **A misleading error message.** "Nothing to change" and "enabled rule needs an active
   department" shared one error code, so the second would have said "already the current
   setting". "Not modified" now has its own code (`MR304`).
3. **Test-side:** an alert assertion also matched Next.js's route announcer, so it is now scoped
   to `<main>`. Two `expect.any` matchers were typed `unknown` for strict lint.

## Production observation (P4 carried over)

The live production AI routed **MIR-1004** automatically on 2026-11-03 (`triage-v3`, 4.3 s,
status Assigned). This confirms the Phase 4 deployment end to end.

## Cloud verification

- [x] Migration `20261103101445` applied to `makeitright-staging`. `supabase migration list
    --linked` shows local = remote for all five migrations.
- [x] Staging checks:
  - `admin_metrics(30)`, evaluated as the existing admin account, returns the real state: 4
    tickets (3 open, 1 closed in the window), 1 awaiting review, 2 AI runs (1 routed, 1 high
    priority review, p50 3.5 s), and all 6 departments.
  - `anon` cannot execute it, and RLS is on for `config_changes`.
- [x] Preview probes on `e3e56c9`: `/api/health` is ok. Signed-out `/admin/departments` gets
      307 to login, and anonymous `GET /api/admin/metrics` gets **401**. CI is green.
- [x] Owner check: the owner delegated the preview check on 2026-11-03. The signed-in admin
      journeys are covered by the E2E suite above (exact workload counts, department toggle with
      change log, routing save, no-op and refusal, axe on desktop and mobile).

**Gate P5: passed.**
