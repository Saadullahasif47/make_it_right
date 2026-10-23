# ADR 0003: Complaint persistence, idempotency and the complaints API

- **Status:** Accepted
- **Date:** 2026-10-23
- **Phase:** P2

## Context

Plan §4 requires submit-first persistence: the ticket and its CREATED event are saved atomically
before anything else happens. BR-08 says a repeated idempotency key never duplicates a ticket.
§10 says mutations happen only through audited, role-checking SQL functions. §11 defines the HTTP
contract: idempotent create, keyset pagination (default 20, maximum 50), a durable rate limit and
a stable error body.

## Decisions

### Writes go through one function

1. **`public.create_ticket()` is the only way to create a complaint.** It is `SECURITY DEFINER`,
   takes the owner from `auth.uid()`, and in one transaction inserts the complaint, its
   `submission_keys` row and the `created` event.
   - No role, admins included, has `INSERT`, `UPDATE` or `DELETE` on `complaints` or
     `ticket_events`.
   - A trigger rejects every `UPDATE` to `ticket_events`, even from the table owner.
2. **Idempotency is tamper-evident.** Each key stores a SHA-256 of the trimmed content.
   - The same key with the same content returns the original ticket (`created = false`, HTTP 200).
   - The same key with different content raises `MR409`, which becomes HTTP 409
     `IDEMPOTENCY_CONFLICT`. A mismatched ticket is never silently returned.
   - Keys are scoped per user.
3. **One per-user transaction lock** (`pg_advisory_xact_lock` on the actor id) serialises a
   user's submissions. That single lock makes both the idempotency check and the rate limit
   race-free.
   - The first design locked per key. A 30-way concurrency test then showed 23 tickets accepted
     against a limit of 20.
   - The integration suite keeps that test.
4. **The rate limit is a durable SQL guard:** 20 tickets per user per 10 minutes (`MR429` → HTTP
   429). Retrying an existing key is not a new submission and is never limited.
5. **Field limits are defined once, in two languages.** Zod gives friendly messages, and check
   constraints are the final guard. A unit test reads the migrations and fails if the numbers
   drift. `strictObject` rejects injected fields (`status`, `category`, `created_by`…) instead of
   ignoring them.

### Reads are scoped by RLS

6. **Who sees what:** students see their own tickets, department staff see tickets assigned to
   their department, and admins see all. Events reuse the complaints policy through
   `EXISTS (…)`, so a timeline is visible exactly when its ticket is.
7. **`list_complaints()` is `SECURITY INVOKER`,** so it returns precisely what RLS allows.
   - The keyset cursor is an opaque, strictly validated base64url token of
     `(created_at, id)`.
   - It is passed as typed RPC arguments; no filter string is built from user input anywhere.
   - One extra row is fetched to detect the next page without a `COUNT`.
8. **Reference numbers** (`MIR-1001`, …) come from an identity column for human use; the UUID
   remains the identifier.

### HTTP API and the web form share one use case

9. **One use case.** `features/complaints/service.ts#submitComplaint` is called by both
   `POST /api/complaints` and the server action behind the form, so the two cannot diverge.
   Phase 4 adds the best-effort AI step after the durable write, inside this use case.
10. **The POST endpoint is hardened beyond the plan's minimum:**
    - JSON only (415 otherwise), which blocks HTML-form CSRF
    - requests are rejected when `Origin` or `Sec-Fetch-Site` shows another site
    - a 16 KB body cap (413)
    - authentication before parsing
    - students only, per the §11 contract (the database allows any profile, per the §5 matrix)
11. **No enumeration.** A ticket the caller may not see is a 404, never a 403, in both the API and
    the pages.
12. **The form's idempotency key** is rendered once per form, server-side, and survives failed
    attempts. A replayed or retried POST therefore maps to the same ticket. The E2E test replays
    the browser's real form request three times. A deliberate mutation that ignored the key made
    it fail with four tickets.
13. **Times are stored in UTC** and shown in the viewer's timezone through `useSyncExternalStore`.
    The server snapshot is UTC, so hydration never mismatches.

## Consequences

- Complaints cannot be edited or deleted from the app. Status changes, assignment and the
  remaining event types arrive in Phase 3 as audited functions that bump `version` (BR-07).
- Deleting a user who owns tickets is refused (`ON DELETE RESTRICT`). Test cleanup removes the
  tickets first with the service role.
