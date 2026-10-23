# ADR 0004: Department workflow, optimistic concurrency and audit

- **Status:** Accepted
- **Date:** 2026-10-23
- **Phase:** P3

## Context

Plan §6 defines the lifecycle (submitted → assigned → in progress → resolved → closed, with
reopen and review paths) and its rules:

- **BR-02:** only staff of the assigned department work a ticket.
- **BR-03:** only the reporter confirms or disputes a resolution.
- **BR-04:** every change appends an event in the same transaction.
- **BR-07:** a stale update returns 409.

Gate P3 requires the full resolution flow to work **without any AI provider**.

## Decisions

### The transition table

1. **One table holds the rules.** `private.ticket_transitions(from, to, role)` is the single source
   of which status changes each role may make. A pure TypeScript copy (`workflow.ts`) decides
   which buttons to show. An integration test reads the table through
   `public.ticket_transition_rules()` and fails if the two differ.
2. **Admins can do every change** any role can. Each one is recorded under the admin's role on
   the timeline, as the "with audit" requirement in plan §5 asks.
3. **Assignment is not a status change.** Routing goes through `assign_ticket()`, which is
   admin-only in Phase 3. AI routing in Phase 4 gets its own privileged path, so no transition
   rule ever leads to `assigned`.

### Every change is one audited, version-checked function

4. **The four functions:** `transition_ticket`, `acknowledge_ticket`, `add_ticket_note` and
   `assign_ticket` are `SECURITY DEFINER`. Each one, in a single transaction:
   1. reads the caller's role from `profiles`
   2. locks the ticket row (`FOR UPDATE`)
   3. applies the read policy's visibility rules
   4. checks `expected_version`
   5. validates the change
   6. bumps `version`
   7. appends the event
5. **Optimistic concurrency is row lock plus version check.** Two simultaneous changes on the
   same version: one wins, and the other gets `MR412`, which becomes HTTP 409 `STALE_VERSION`.
   - A mutation that removed `FOR UPDATE` made the integration test fail with both requests
     "succeeding", which is a lost update.
   - The UI shows the conflict with a Refresh link instead of overwriting.
6. **Error semantics:**
   - Invisible means not found (`MR404`), so ids cannot be probed.
   - A visible ticket with the wrong role is `MR403`.
   - A wrong current status is `MR422` (HTTP 409 `INVALID_TRANSITION`).
   - Missing input is `22023`.
7. **Notes are required where they carry meaning.** Resolving needs a description of the fix and
   reopening needs a reason, each at least 5 characters, enforced in Zod and in SQL. Work notes
   don't change the ticket, so they don't bump the version.
8. **Acknowledgement** is a recorded step that sets `acknowledged_at` once per assignment.
   Reassignment clears it, so the new department acknowledges again.

### The audit timeline

9. **Each event snapshots the actor's role**, and for assignments the department, category and
   priority. The timeline says "Department staff" or "Administrator" without letting students
   read staff profiles.
10. **The backfill respects append-only history.** The migration pauses the append-only
    trigger for exactly one backfill statement inside its transaction. An upgrade rehearsal
    applied the migration on top of an existing ticket and confirmed both the backfill and the
    re-enabled trigger.

### Queues

11. **`list_complaints()` gains sort orders:** `newest`, `oldest` and `priority` (most urgent
    first, then longest waiting), each with its own keyset predicate. The priority sort carries
    the priority in the cursor.
12. **Department queue:** active tickets, oldest first by default, with a "New" marker until a
    ticket is acknowledged.
13. **Admin review queue:** submitted, triaging and needs-review tickets, oldest first. With AI
    off, every new report starts here.
14. **Default routing rules** (category → department) are seeded reference data and readable by
    admins only. The assignment form pre-selects a category's default department until the admin
    picks one by hand.

## Consequences

- Managing routing rules and department availability from the UI is Phase 5
  (`/admin/departments`). Role management stays a privileged seed operation.
- The routing rules live in the seed, so a cloud database needs the seed applied after this
  migration. `--include-seed` does not re-run a seed that changed since its first run (it only
  updates the stored hash), so the changed seed is applied with `supabase db query --linked -f`.
  The seed is idempotent. See the cloud-environments runbook.
