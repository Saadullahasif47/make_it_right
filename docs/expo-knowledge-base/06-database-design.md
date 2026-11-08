# 06. Database design

Source of truth: the 15 migration files in [`supabase/migrations/`](../../supabase/migrations), the
seed [`supabase/seed.sql`](../../supabase/seed.sql), and the 14 pgTAP files in
[`supabase/tests/`](../../supabase/tests).

## 1. Key ideas first, in simple words

| Idea                   | Simple explanation                                             | In MakeItRight                                                                                       |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Normalisation          | Store each fact once and point to it, instead of copying it    | Departments, rooms and equipment are their own tables; complaints point to them by id                |
| Referential integrity  | A pointer must point to something that exists                  | Foreign keys everywhere; an asset must be in its case's room (composite foreign key)                 |
| Transaction            | Several changes that happen all together or not at all         | Creating a ticket writes the complaint, the key, the event and the case in one transaction           |
| Constraint             | A rule the database refuses to break                           | Title 5–120 characters; photo ≤ 2 MiB; "unsure analysis must need review"                            |
| Unique constraint      | "There can only be one"                                        | One active work order per case; one pending proposal per case; one active alert per rule and subject |
| Idempotency            | Doing the same request twice has the same effect as once       | `submission_keys`: same key + same content → same ticket                                             |
| Optimistic concurrency | Each row has a version; a change must say which version it saw | `expected_version`; a stale page gets HTTP 409 instead of overwriting                                |
| Row-level security     | The database filters rows per user                             | Students see their own complaints, staff their department's, admins all                              |
| Audit trail            | History that cannot be edited                                  | `ticket_events`, `case_events`, `maintenance_alert_events` reject updates; `config_changes` too      |
| Aggregation            | Counting and grouping in SQL                                   | Dashboard, heatmap and alert rules are SQL functions                                                 |
| Vector column          | A column that stores a list of numbers representing meaning    | `complaint_embeddings.embedding vector(768)`                                                         |

## 2. Reports vs maintenance cases

- A **complaint** (report, ticket, `MIR-1001…`) is what one student wrote. It belongs to that
  student forever.
- A **maintenance case** (`MC-5001…`) is the real-world problem. Every complaint gets its own case
  automatically when it is created.
- When an administrator links duplicates, the report moves to the other case (`case_reports`); its
  old case becomes `merged` and keeps its history.
- Each student keeps their own report page, history and confirmation. A staff or admin change on
  any linked ticket updates the case and is copied to the other open tickets; the case closes when
  its last report is closed.

Why: counting "how many problems" must not count ten reports of one projector as ten problems
(the heatmap counts distinct cases), but each student must still see and confirm their own report.

## 3. Tables

27 tables in `public`, all with row-level security enabled. "Who can read" is the RLS policy;
**nobody** has direct `INSERT`, `UPDATE` or `DELETE` through the API on the core tables: every
write goes through a function.

### Identity and organisation

| Table            | Purpose                                  | Key columns / constraints                                                                     | Read access (RLS)  | Changed by                                                         |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `profiles`       | One row per user: role, department, name | PK = `auth.users.id`; `role` enum; `department_id` only when role is department (check)       | Own row, or admin  | Signup trigger; user may update only `display_name` (column grant) |
| `departments`    | The six departments                      | `code` unique, `is_active`                                                                    | Any signed-in user | `admin_set_department_active`                                      |
| `routing_rules`  | Category → default department            | PK `category`, `department_id` FK, `enabled`                                                  | Admin              | `admin_set_routing_rule`                                           |
| `config_changes` | Log of configuration changes             | Before/after values, actor id (no FK, so deleting a user never rewrites history); append-only | Admin              | The two admin functions                                            |

### Complaints and routing

| Table             | Purpose              | Key columns / constraints                                                                                                            | Read access                                       | Changed by                                                                                        |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `complaints`      | The reports          | `reference_no` identity from 1001; `status` (8 states); `version`; `category`, `priority`; length checks; `created_by` FK (restrict) | Reporter, staff of the assigned department, admin | `create_ticket`, `transition_ticket`, `acknowledge_ticket`, `assign_ticket`, `agent_*`, case sync |
| `ticket_events`   | Append-only timeline | Event type, actor kind (user/agent/rule/system), actor role, snapshots; trigger rejects updates                                      | Whoever can see the complaint                     | The same functions                                                                                |
| `submission_keys` | Idempotency keys     | Per user; SHA-256 of the content                                                                                                     | No API role                                       | `create_ticket`                                                                                   |
| `agent_runs`      | AI routing attempts  | Model, prompt version, outcome, code, duration, trace; unique "one running attempt per complaint"                                    | Admin                                             | `agent_begin_run`, `agent_finish_run` (service role)                                              |

Indexes: `(created_by, created_at desc, id desc)` for the student list, `(assigned_department_id,
status, created_at desc)` for queues, `(created_at desc, id desc)` for keyset pagination.

### Maintenance foundation (A0)

| Table                   | Purpose                               | Key columns / constraints                                                                                                                                    | Read access                           |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `maintenance_locations` | Buildings, floors, rooms              | Unique `(building_code, floor, room_code)`; codes must be upper case; `map_x`, `map_y` for the floor plan                                                    | Any signed-in user                    |
| `asset_registry`        | Equipment (e.g. `PRJ-ENG-204`)        | Unique `asset_code`; `location_id` FK                                                                                                                        | Any signed-in user                    |
| `maintenance_cases`     | The real-world problem                | `reference_no` from 5001; status (7 + `merged`); `version`; `is_synthetic`; composite FK `(asset_id, location_id)` so equipment is always in the case's room | Admin; staff of the case's department |
| `case_reports`          | Which complaint belongs to which case | PK `complaint_id` (a report is in exactly one case); `case_id` FK                                                                                            | With the case                         |
| `case_events`           | Append-only case history              | Event type, actor, previous/new status                                                                                                                       | With the case                         |

Students see no case tables; their view is their complaint. Reporters read repair photos through
`repair_verification_view(complaint_id)` instead.

### Evidence and jobs (A1)

| Table                  | Purpose                           | Key columns / constraints                                                                                                               | Read access                |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `evidence_attachments` | Photo metadata (bytes in Storage) | Exactly one parent (complaint or case); JPEG/PNG/WebP; ≤ 2 MiB; path `<uploader>/<id>.<ext>`; state pending/finalized/rejected; SHA-256 | Whoever can see the parent |
| `ai_jobs`              | Durable job record                | `job_type`, `target_id`, unique `dedupe_key`, `status`, `attempts` 0–10, `next_retry_at` iff `retry_wait`, `target_version`             | Admin                      |

### F1 visual inspection

| Table                     | Purpose                       | Key columns / constraints                                                                                  | Read access        |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| `visual_analyses`         | The model's answer, immutable | One per (photo, prompt version); all schema fields; flags; check "unsure ⇒ needs review"; updates rejected | Like the complaint |
| `visual_analysis_reviews` | Human responses               | confirmed / disputed / corrected; append-only; max 10 per person per analysis                              | Like the analysis  |

### F2 duplicates

| Table                  | Purpose               | Key columns / constraints                                                        | Read access                                     |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `complaint_embeddings` | One vector per report | PK `complaint_id`; `embedding vector(768)`; model; text hash                     | **No API role**                                 |
| `match_candidates`     | Suggested duplicates  | `complaint_id`, `candidate_case_id`, features, score, decision; one row per pair | Admin; staff for their own department's reports |

### F3 coordination

| Table                  | Purpose                        | Key columns / constraints                                                                                               | Read access   |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| `case_work_orders`     | Who works a case               | Status active/completed/cancelled; source; **partial unique index: one active work order per case**                     | With the case |
| `coordination_runs`    | Each coordinator run           | One per job; model; prompt version; outcome; reason code; tool trace (array check); case version                        | Admin         |
| `work_order_proposals` | A proposal awaiting a decision | Department, category (classified), priority (assessed), rationale 1–400 chars, policy reasons; **one pending per case** | Admin         |

### F4 repair verification

| Table                  | Purpose                      | Key columns / constraints                                                                 | Read access                            |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| `repair_evidence`      | Before/after label per photo | Append-only; at most 12 per case                                                          | With the case (reporters via the view) |
| `verification_reviews` | One repair check             | State pending/awaiting_decision/confirmed/rework/superseded; **one open review per case** | With the case                          |

### F5/F6 heatmap and insights

| Table                      | Purpose                  | Key columns / constraints                                                                       | Read access |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- | ----------- |
| `maintenance_sla_policies` | Target days per category | `target_days` 1–90                                                                              | Admin       |
| `maintenance_alerts`       | Recurrence alerts        | Rule code, subject, `case_ids` (≥ 1), window, metric; **one active alert per rule and subject** | Admin       |
| `maintenance_alert_events` | Alert history            | Raised / acknowledged / cleared, who, note; append-only                                         | Admin       |

## 4. Functions: how changes happen

Exactly 32 public functions are executable by signed-in users. A pgTAP test
(`001_schema_guarantees`) lists all 32 and fails if any other function becomes executable by
`authenticated`. By group:

| Group    | Functions                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tickets  | `create_ticket`, `list_complaints`, `transition_ticket`, `acknowledge_ticket`, `add_ticket_note`, `assign_ticket`, `ticket_transition_rules`                                                                                                       |
| Admin    | `admin_metrics`, `admin_set_department_active`, `admin_set_routing_rule`, `admin_retry_ai_job`                                                                                                                                                     |
| Evidence | `request_evidence_upload`, `finalize_evidence_upload`, `discard_evidence_upload`, `request_repair_evidence_upload`, `finalize_repair_evidence_upload`                                                                                              |
| F1–F4    | `photo_analysis_states`, `review_visual_analysis`, `request_duplicate_check`, `review_match_candidate`, `dismiss_match_candidates`, `request_case_coordination`, `admin_decide_proposal`, `repair_verification_view`, `decide_repair_verification` |
| F5/F6    | `admin_heatmap`, `admin_heatmap_room`, `admin_maintenance_insights`, `admin_acknowledge_alert`, `admin_refresh_alerts`, `admin_set_category_sla`, `set_case_location`                                                                              |

Service-role only (the AI paths): `agent_begin_run`, `agent_finish_run`, and the `worker_*`
functions (claim, complete, fail, save analysis, duplicate features, coordination reads and
finish, save verification).

Every changing function: checks the caller's role from `profiles`, locks the row, checks the
version, validates, bumps the version, appends an event, all in one transaction. Errors use
stable codes: `MR403` forbidden, `MR404` not found (also for "exists but invisible"), `MR409`
idempotency conflict, `MR412` stale, `MR422` invalid transition, `MR429` limit, `22023` bad input.

## 5. Row-level security

**Simple:** the database adds an invisible "and you are allowed to see this" condition to every
query.

**Technical:**

1. The first migration revokes Supabase's default grants on new tables and functions, including
   the global `EXECUTE` to `PUBLIC` (a pgTAP test caught that a schema-scoped revoke was not
   enough).
2. Each table enables RLS and gets explicit `SELECT` policies (listed above). There are no
   insert/update/delete policies for API roles on core tables.
3. Policy helpers are `SECURITY DEFINER` functions in a `private` schema that the Data API does not
   expose, with a pinned `search_path`. They read the role from `profiles` using `auth.uid()`;
   JWT claims like `app_metadata.role` are ignored.
4. Child tables reuse the parent's rule with `EXISTS (...)`, so a timeline is visible exactly when
   its ticket is.
5. Storage objects have their own policies that call the same helpers.

**Example:** `complaints_select_scoped` allows a row when you created it, or you are staff of
its assigned department, or you are an admin.

## 6. Idempotency and concurrency in detail

- `create_ticket` takes `pg_advisory_xact_lock` on the user id, so a user's submissions are
  serialised. A first design locked per key; a 30-way concurrency test then accepted 23 tickets
  against a limit of 20, so the lock moved to the user.
- Same key + same content → `created = false`, HTTP 200, same ticket. Same key + different
  content → `MR409`, HTTP 409. Measured: 20/20 simultaneous pairs → one ticket each; 10
  simultaneous submissions with one key → 1 ticket.
- Status changes: `SELECT … FOR UPDATE` + version check. A test that removed `FOR UPDATE` made two
  simultaneous changes both "succeed" (a lost update), proving the lock matters.
- Jobs: the queue message's attempt number is the delivery token; a late report from a timed-out
  worker is refused (`MR412`).

## 7. Aggregation, vectors and indexes

- Dashboard: `admin_metrics` builds one jsonb document in one snapshot, as the admin.
- Heatmap: `admin_heatmap` counts distinct non-merged cases per room with filters; index
  `(location_id, status, opened_at desc)`.
- Alerts: `private.maintenance_rule_hits` computes the four rules; partial unique index for
  deduplication.
- Vectors: `complaint_embeddings.embedding vector(768)`. Similarity is computed **exactly** with
  pgvector's cosine distance over a small, pre-filtered set (open cases, same building, last 30
  days). There is **no approximate vector index (HNSW or IVFFlat)**. At the current size that is
  fine and exact; at a much larger scale an HNSW index would be added.

## 8. Migrations

15 forward-only, additive files. Applied locally by `supabase db reset` and in CI; applied to the
cloud by hand after a dry run (`supabase db push`). Rollback strategy: switch the feature off and
redeploy; fix schema defects with a new corrective migration; never drop tables in an emergency
([ADR 0008](../adr/0008-maintenance-foundation.md)).

## 9. Synthetic demo campus (seed)

| Item          | Count    | Source                                                                                                                  |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Departments   | 6        | Electrical Maintenance, IT Services, Plumbing, Furniture and Fixtures, Sanitation and Cleaning, Facilities Office       |
| Routing rules | 6        | electrical→Electrical, it_equipment→IT, plumbing→Plumbing, furniture→Furniture, sanitation→Sanitation, other→Facilities |
| Buildings     | 3        | Engineering Block (ENG), Science Block (SCI), Library and Student Centre (LIB)                                          |
| Rooms         | 36       | 3 buildings × 2 floors × 6 rooms: CR-n01, CR-n02, LAB-n03, LAB-n04, WC-n05, OFF-n06                                     |
| Equipment     | 12       | e.g. `PRJ-ENG-204`, `PRJ-ENG-203` (deliberate look-alike), `SNK-ENG-105`, `ACU-SCI-103`                                 |
| History       | 60 cases | `private.reset_synthetic_campus_history()`, labelled `is_synthetic`, resettable                                         |
| SLA targets   | 6        | electrical 7, IT 7, plumbing 3, furniture 14, sanitation 2, other 14 days                                               |

The 60 synthetic cases are designed scenarios: a repeat-failure projector, a similar-named hard
negative, a recent reopen, a long-unresolved case, an Engineering building cluster and an unknown
room. They are timed relative to `now()`, and re-running the seed replaces only synthetic cases.

## 10. Likely judge questions

- **"Is your schema normalised?"** Yes for reference data (departments, rooms, equipment,
  routing). Events deliberately snapshot the actor role and assignment at the time, because history
  must show what was true then, not now.
- **"Why so much logic in SQL?"** Because the database is the one place every path goes through:
  the web app, the AI worker, scripts. Rules there cannot be skipped by a bug in one caller.
- **"How do you stop two staff overwriting each other?"** Row lock plus version check; the loser
  gets 409 and a refresh link.
- **"How do linked reports share a case without losing history?"** `case_reports` moves; the old
  case is marked `merged` with a pointer; every event is kept.
