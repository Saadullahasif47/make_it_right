# Evidence: Phase 2, core complaint persistence

**Gate P2:** 20 synthetic complaints save correctly; duplicated clicks do not duplicate; student A
cannot see student B.

## Task checklist (plan §15)

| ID    | Task                                                                  | Status | Evidence                                                                        |
| ----- | --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| P2.01 | complaints, ticket_events, submission_keys with FK/checks and indexes | Done   | `migrations/20261023122610_complaints_and_ticket_events.sql`                    |
| P2.02 | RLS read policies for student, department, admin                      | Done   | `complaints_select_scoped`, `ticket_events_select_with_complaint`; pgTAP 003    |
| P2.03 | `create_ticket` RPC: server-derived owner, idempotency, CREATED event | Done   | pgTAP 003 (creation, idempotency, rate limit)                                   |
| P2.04 | Zod complaint input; accessible form with validation                  | Done   | `features/complaints/schemas.ts`, `complaint-form.tsx`; E2E field errors, axe   |
| P2.05 | `POST /api/complaints` through the authenticated RPC, no AI yet       | Done   | `features/complaints/api.ts`; unit `api.test.ts`; E2E API contract              |
| P2.06 | Scoped list and detail with keyset pagination and events              | Done   | `list_complaints()`; list/detail pages; E2E 25-ticket pagination and filters    |
| P2.07 | Duplicate idempotency key → one complaint                             | Done   | 10 simultaneous identical calls → 1 ticket; E2E triple replay of the form POST  |
| P2.08 | Concurrent creation and two-student read isolation                    | Done   | 20 parallel → 20 unique refs; 30 parallel → exactly 20 (limit); isolation tests |
| P2.09 | SQL tests for unauthorized updates and injected role/status fields    | Done   | pgTAP 003 direct-write denials; API rejects injected fields; smuggled RPC args  |
| P2.10 | Preview deploy; submitted ticket persists after refresh               | Done   | Cloud verification below                                                        |

## Local verification (2026-10-23)

| Suite                         | Result                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| lint / typecheck / format     | Pass                                                               |
| Unit + component (Vitest)     | **228 / 228**                                                      |
| pgTAP (`pnpm db:test`)        | **77 / 77** (37 new complaint assertions)                          |
| API integration (Auth + REST) | **42 / 42**, stable over three consecutive runs                    |
| E2E (Playwright)              | **116 / 116** (desktop Chromium + Pixel 7)                         |
| Production build              | Pass; `/api/complaints` dynamic, complaint pages Partial Prerender |

### Gate P2 criteria, as tested

- **20 synthetic complaints save correctly:** `complaints-api.test.ts` submits the 20-item
  fictional fixture (all six categories). It checks every field round-trips, each ticket has
  exactly one CREATED event, and the 20 references are unique and increasing.
- **Duplicated clicks do not duplicate:**
  - 10 simultaneous `create_ticket` calls with one key produce one ticket, one event and exactly
    one `created = true`.
  - E2E replays the browser's real form-action request three more times; still one ticket.
  - The same key with different content gets a 409.
- **Student A cannot see student B:**
  - B gets an empty result by id, an empty timeline and an empty list for A's tickets.
  - The page shows the 404 view and the API returns 404.
  - Department staff see only tickets assigned to them; admins see all.

## Mutation checks (do the tests catch real faults?)

| Fault deliberately introduced                                      | Detected by                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Complaints read policy replaced with `USING (true)` + status grant | 7 pgTAP failures (isolation, status write, department scope) |
| Server action ignores the form's idempotency key                   | E2E replay test fails: **4 tickets instead of 1**            |

The first version of the double-submit E2E test (two `requestSubmit()` calls) **survived** the
second mutation: React queued the second submission and dropped it after the redirect, so it
never reached the server. It was replaced with the request-replay test above, which now fails
against the mutant and passes against the real code.

## Defects found by testing and fixed in this phase

1. **Rate-limit race under concurrency.** Locking per idempotency key let 30 simultaneous
   distinct submissions through as **23 tickets** against a limit of 20. Fixed by locking per
   user (ADR 0003, decision 3). The 30-way test now passes: exactly 20 accepted, 10 refused.
2. **A vacuous E2E test** (described above) was replaced.
3. **A ticket reference broke at its hyphen on mobile.** It is now non-breaking.
4. **Test-side:** a `form` locator also matched the header's sign-out form, so it is scoped to
   `<main>`. Test cleanup deletes a user's tickets first, because the database correctly refuses
   to delete a profile that owns complaints.

## Cloud verification

- [x] Migration `20261023122610` applied to `makeitright-staging` with `supabase db push`.
      `supabase migration list --linked` shows local = remote for `20261022115901` and
      `20261023122610`.
- [x] Preview <https://makeitright-git-phase-p2-complaints-takeasy1.vercel.app> on `8f4ae39`:
      `/api/health` is ok. Signed-out `/student/complaints` and `/student/complaints/new` get
      **307 → `/login?next=…`**. Anonymous `POST` and `GET /api/complaints` get **401**, and a
      cross-site `POST` gets **403**.
- [x] Owner check on the preview: Demo Student One submitted a fictional report, saved as
      **MIR-1001**, the first ticket on the cloud database.
  - The report shows its "Report submitted" event and local-time timestamps.
  - It persists after a refresh and appears in My complaints with the Submitted badge.
- [x] Owner check: Demo Student Two sees an empty list, and opening MIR-1001's URL shows the
      "This page does not exist" view.

**Gate P2: passed.**
