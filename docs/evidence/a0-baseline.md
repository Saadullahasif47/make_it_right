# Evidence: Add-on phase A0, compatibility and safety baseline

**Gate A0 (plan v2 §14):** baseline unchanged; new schema deployed to preview; AI feature flags
all OFF.

Design decisions: [ADR 0008](../adr/0008-maintenance-foundation.md).

## Task checklist

| ID    | Task                                                         | Status | Evidence                                                                                  |
| ----- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------- |
| A0.01 | Branch; document current routes, migrations and statuses     | Done   | Branch `phase/a0-baseline`; [inventory below](#a001-current-baseline)                     |
| A0.02 | Feature flags for F1–F6 and AI model variables, all OFF      | Done   | `src/lib/config/server-config.ts`; unit tests; full E2E with every flag unset             |
| A0.03 | Migrations for locations, cases, links, photo metadata, jobs | Done   | `20261104210000_maintenance_foundation.sql`; [upgrade rehearsal](#upgrade-rehearsal)      |
| A0.04 | RLS/GRANT tests for every new table; mutations only via RPC  | Done   | `008_maintenance_foundation.test.sql` (70); `maintenance-foundation.test.ts` (14)         |
| A0.05 | Synthetic campus: 3 buildings, 36 rooms, 12 assets, 60 cases | Done   | `seed.sql` + `private.reset_synthetic_campus_history()`; [seed re-run](#synthetic-campus) |

The branch is `phase/a0-baseline` rather than the plan's single `feature/advanced-features`: each
add-on phase gets its own branch and pull request, as in v1.

## A0.01 Current baseline

Recorded on `main` at `957ae0e`, before any add-on change.

### Routes

| Route                                   | Who                  | Notes                                        |
| --------------------------------------- | -------------------- | -------------------------------------------- |
| `/`                                     | Public               | Landing page                                 |
| `/login`, `/signup`, `/forgot-password` | Public               | Supabase Auth; no account enumeration        |
| `/account/password`, `/auth/confirm`    | Email link           | `token_hash` confirmation, PKCE fallback     |
| `/student/complaints`, `/new`, `/[id]`  | Student              | Own tickets, submission form, ticket detail  |
| `/department`, `/department/[id]`       | Department staff     | Department queue and ticket detail           |
| `/admin`                                | Admin                | Metrics dashboard                            |
| `/admin/review`, `/admin/tickets`       | Admin                | Review queue; all tickets with `?ticket=`    |
| `/admin/complaints/[id]`                | Admin                | Ticket detail, assignment, AI runs, retry    |
| `/admin/departments`                    | Admin                | Department availability and routing rules    |
| `POST /api/complaints`                  | Student              | Idempotent create; AI triage after the write |
| `GET /api/complaints`                   | Signed in            | Keyset pagination, RLS-scoped                |
| `GET /api/complaints/[id]`              | Signed in            | 404 when not visible                         |
| `PATCH /api/complaints/[id]/status`     | Department, reporter | `transition_ticket` with `expectedVersion`   |
| `POST /api/complaints/[id]/review`      | Admin                | `assign_ticket`                              |
| `POST /api/complaints/[id]/retry-ai`    | Admin                | Bounded AI retry                             |
| `GET /api/admin/metrics`                | Admin                | `admin_metrics(7/30/90)`                     |
| `GET /api/health`                       | Public               | Never prerendered                            |

### Migrations

| Migration                                     | Phase | Adds                                                    |
| --------------------------------------------- | ----- | ------------------------------------------------------- |
| `20261022115901_identity_and_access`          | P1    | Roles, profiles, departments, secure default privileges |
| `20261023122610_complaints_and_ticket_events` | P2    | Complaints, append-only events, idempotency keys        |
| `20261023140440_ticket_workflow`              | P3    | Transition table, audited workflow functions, routing   |
| `20261023184646_agent_triage`                 | P4    | `agent_runs`, service-role-only agent functions         |
| `20261103101445_admin_operations`             | P5    | `admin_metrics`, audited configuration, change log      |
| `20261104120000_list_complaints_search`       | UI    | Search in `list_complaints`                             |

### Ticket statuses

`submitted → triaging → needs_review | assigned → in_progress → resolved → closed`, with
`resolved → reopened → in_progress`. Only the audited functions change status
(`private.ticket_transitions`, ADR 0004). Priorities: `unassessed`, `low`, `medium`, `high`.
Categories: `unclassified`, `electrical`, `it_equipment`, `plumbing`, `furniture`, `sanitation`,
`other`.

### AI routing (unchanged by A0)

Gemini `gemini-3.1-flash-lite`, then the backup model `gemini-3.5-flash` on overload, then the
keyword fallback; safety and high-priority reports always go to a person (ADR 0005 and its
amendments).

## Upgrade rehearsal

The migration was applied on top of a database holding tickets, as ADR 0004 did:

1. `supabase db reset --version 20261104120000 --no-seed` (the last v1 migration).
2. Three tickets created through `create_ticket` as a signed-in user: MIR-1001 at `" eng "` /
   `"lab-204"`, MIR-1002 at an unknown building, and MIR-1003, which was then closed.
3. `supabase migration up --local` applied `20261104210000_maintenance_foundation.sql`. A second
   run applied nothing (`"applied":[]`).

| Ticket   | Status    | Case | Case status | Located                                    |
| -------- | --------- | ---- | ----------- | ------------------------------------------ |
| MIR-1001 | submitted | 5001 | open        | After the seed: ENG LAB-204 (logged event) |
| MIR-1002 | submitted | 5002 | open        | UNKNOWN (no such building)                 |
| MIR-1003 | closed    | none | n/a         | Closed tickets are not backfilled (M2)     |

## Synthetic campus

The seed was run twice against the upgraded database:

| Run | Located cases | Synthetic cases |
| --- | ------------- | --------------- |
| 1   | 1             | 60              |
| 2   | 0             | 60              |

After both runs: 36 locations, 12 assets, 60 synthetic cases with 281 events, and the 2 real
cases untouched. Status mix: 53 closed, 2 in progress, 2 open, 1 assigned, 1 reopened, 1 needs
review. Cases opened in the last 30 days: Engineering 6, Science 3, Library 2, unknown room 1.

All of it is fictional and flagged `is_synthetic`. It is meant for F5/F6 scenario evaluation, not
as real history.

## Mutation checks

To show the new tests catch real defects, the database was weakened on purpose and
`008_maintenance_foundation` re-run:

- granting `UPDATE` on `maintenance_cases` with a permissive policy;
- disabling the ticket-to-case mirror trigger.

15 assertions failed: the privilege check, every mirroring step, department visibility, and "a
student cannot change a case status". After the database was restored, all 70 pass.

## Local verification

Run on 2026-11-05 on `phase/a0-baseline`, against a fresh local stack (`supabase db reset`).
Every feature flag was unset (OFF).

| Suite                        | Result                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| `pnpm lint`                  | Pass, 0 warnings                                                           |
| `pnpm typecheck` (tsc)       | Pass                                                                       |
| `pnpm format:check`          | Pass                                                                       |
| `pnpm test` (unit + DOM)     | **444 / 444** (4 new: feature switches and model variables)                |
| `pnpm db:test` (pgTAP)       | **314 / 314** in 8 files (70 new in `008_maintenance_foundation`)          |
| `pnpm test:integration`      | **104 / 104** (14 new, over the real Data API)                             |
| `pnpm build`                 | Pass                                                                       |
| `pnpm test:e2e` (Playwright) | **193 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed |

The E2E suite runs on desktop Chromium and Pixel 7. It includes the AI routing journeys against
the Gemini stub (primary model, backup model, keyword fallback), auth, submission, workflow,
queues, admin, accessibility (axe), motion and keyboard checks. None of them changed, and all
pass with the new triggers in place.

## Not yet verified

- **Preview deployment of the schema.** The gate needs the migration on the cloud project, which
  serves both preview and production (ADR 0007). Pushing it needs the owner's approval. A
  read-only check (2026-11-05) confirmed that the project offers `vector` 0.8.2, `pgmq` 1.5.1,
  `pg_cron` 1.6.4 and `pg_net` 0.20.4, the same versions as local.
- No user-visible change exists in A0, so there is no new Playwright journey. The full existing
  suite runs with every flag unset, which is the "disabled features do not change normal
  submission" check.
