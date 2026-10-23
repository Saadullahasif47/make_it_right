# Evidence: Phase 3, department workflow and audit

**Gate P3:** full complaint resolution works without any AI provider, with correct permissions and
an immutable audit trail.

## Task checklist (plan §15)

| ID    | Task                                                                | Status      | Evidence                                                                             |
| ----- | ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| P3.01 | Legal transition table and pure domain validator                    | Done        | `private.ticket_transitions`; `workflow.ts`; integration drift guard against the DB  |
| P3.02 | `transition_ticket` RPC with expected version and atomic event log  | Done        | `migrations/20261023140440_ticket_workflow.sql`; pgTAP 004                           |
| P3.03 | `routing_rules` and safe manual admin assignment                    | Done        | `assign_ticket()`; seeded default rules; pgTAP 004 (admin-only, inactive department) |
| P3.04 | Department dashboard filtered to `assigned_department_id`           | Done        | `/department`; active/all filters, oldest/priority/newest sort; E2E isolation        |
| P3.05 | Acknowledge, start work, resolve and add-remark controls            | Done        | `workflow-panel.tsx`; E2E Gate P3 lifecycle                                          |
| P3.06 | Student confirmation, or dispute and reopen                         | Done        | Reporter "Is it fixed?" panel; reopen requires a reason; E2E lifecycle               |
| P3.07 | Admin manual review list and reassign action                        | Done        | `/admin/review`, `/admin/complaints/[id]`; integration stale-reassignment test       |
| P3.08 | Two clients edit one ticket: second gets a conflict, no lost update | Done        | Integration: concurrent transitions → exactly one `MR412`; E2E two-tab conflict      |
| P3.09 | Cross-role E2E tests and immutable audit tests                      | Done        | `tests/e2e/workflow.spec.ts`; pgTAP 004 append-only and role-snapshot assertions     |
| P3.10 | Deploy and demonstrate the manual lifecycle with AI disabled        | In progress | Cloud verification below                                                             |

## Local verification (2026-10-23)

| Suite                         | Result                                                    |
| ----------------------------- | --------------------------------------------------------- |
| lint / typecheck / format     | Pass                                                      |
| Unit + component (Vitest)     | **265 / 265**                                             |
| pgTAP (`pnpm db:test`)        | **129 / 129** (52 new workflow assertions)                |
| API integration (Auth + REST) | **54 / 54**, stable over three consecutive runs           |
| E2E (Playwright)              | **126 / 126** (desktop Chromium + Pixel 7), axe clean     |
| Production build              | Pass, from a clean `.next`                                |
| Upgrade rehearsal             | P2 schema + existing ticket → `migration up`; backfill ok |

### Gate P3 criteria, as tested

- **Full resolution without AI:** the E2E lifecycle drives one ticket through the UI with three
  signed-in roles. The student reports, the admin routes it from the review queue, electrical
  staff acknowledge, start work and resolve with a note, and the student confirms and closes it.
  No AI provider is configured anywhere in the run.
- **Correct permissions:**
  - Staff of another department get the 404 view and an empty queue; the API returns 404.
  - A student cannot start or resolve work; department staff cannot close or reassign (`MR403`).
  - An illegal change from the current status is refused (`MR422`, HTTP 409).
  - Direct table writes stay denied; only the definer functions change a ticket.
- **Immutable audit trail:**
  - Every change appends exactly one event in the same transaction, with the actor's role and,
    for assignments, the department, category and priority.
  - Rewriting history after the workflow runs is still refused (pgTAP 004 re-checks the P2
    append-only guarantee), and the migration's backfill is the only place the trigger pauses.
  - The timeline names actors by role, so students never read staff profiles.
- **No lost updates:** two simultaneous transitions on one version produce one success and one
  `STALE_VERSION`; the UI shows the conflict with a Refresh link instead of overwriting.

## Mutation checks (do the tests catch real faults?)

| Fault deliberately introduced                               | Detected by                                         |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `require_version` made a no-op, plus a rogue transition row | **6 pgTAP failures** (stale version, rule contents) |
| `FOR UPDATE` removed from `lock_visible_ticket`             | Concurrency test fails: **both requests "ok"**      |

Both faults were reverted with `supabase db reset` and the suites re-run green.

## Defects found by testing and fixed in this phase

1. **Duplicate field ids on the ticket page.** Several workflow forms each rendered a
   `field-note` textarea, so the work-note label pointed at the resolve box and the note
   submitted empty. Found by E2E. Fields now take an `id`, and each form uses `useId()`.
2. **Colour contrast (latent since P1).** `--success` on `--success-soft` was 4.43:1, below AA.
   Changed to `#13744a` (5.1:1 on the soft fill, 5.8:1 on white); axe is clean on every page.
3. **Stale CSS from the incremental build cache** hid the contrast fix during one run. A clean
   build confirmed it; the runbook now has a troubleshooting note.
4. **Test-side:** the expected rule order now follows enum order, two weak pgTAP assertions were
   strengthened, and an E2E expectation was corrected (notes stay available after resolve).

## Cloud verification

- [ ] Migration `20261023140440` applied to `makeitright-staging` with
      `supabase db push --include-seed` (routing rules live in the seed).
- [ ] `supabase migration list --linked` shows local = remote for all three migrations.
- [ ] Preview `/api/health` ok; signed-out `/department` and `/admin/review` redirect to login;
      anonymous `PATCH /api/complaints/{id}/status` gets 401.
- [ ] Owner check on the preview: one fictional ticket goes report → assign → acknowledge →
      start → resolve → close with the demo accounts, and the timeline shows each role.

**Gate P3: in progress.**
