# ADR 0008: Maintenance cases, feature switches and the add-on foundation

- **Status:** Accepted
- **Date:** 2026-11-05
- **Phase:** A0 (Advanced Features add-on)

## Source of truth

The _MakeItRight Advanced Features Implementation Master Plan v2.0_ (03 Nov 2026) specifies six
add-on features (F1–F6) built in phases A0–A7. It extends the v1 plan and does not replace it.
ADRs 0001–0007 still apply.

## Context

Plan §03 asks for a **maintenance case**: the operational record of one real-world issue, which
may represent several student complaints. §04 lists the new tables, and A0 asks for:

- feature switches that are all OFF;
- additive migrations with a rollback plan;
- RLS tests for every new table;
- a re-runnable synthetic campus.

All of this without changing the baseline app.

The plan's critical rule is that there is **one source of status truth**: a case and its
complaints must never disagree.

## Decisions

### Cases mirror tickets until reports can be linked

1. **Every complaint gets a case from the moment it exists.**
   - An `AFTER INSERT` trigger on `complaints` opens a case and links the report in the same
     transaction as `create_ticket`.
   - The migration backfills one case for each open ticket (plan M2). Closed tickets get none;
     if one ever becomes active again, it gets a case then.
   - Heatmap and insight counts (F5, F6) therefore never miss a report.
2. **The audited ticket functions stay the only way to change status.**
   - An `AFTER UPDATE` trigger copies status, department, category and priority onto the
     report's case, bumps the case `version` and appends one `case_events` row.
   - It runs in the ticket function's own transaction, under its row lock, so the case cannot
     drift from the ticket. A race between two people on one version produces exactly one case
     change; an integration test proves it.
   - We chose this over editing `create_ticket`, `assign_ticket`, `transition_ticket` and
     `agent_finish_run`. Rewriting four audited, heavily tested functions for an additive phase
     was the larger risk.
3. **Shared cases are left alone.** When a case represents more than one report (possible from
   A3), a single ticket no longer drives it. A3 adds the case-led transition function that
   updates the case and then its complaints (plan §03), and the ticket routes for linked
   complaints will call it.
4. **Case statuses:** `open`, `needs_review`, `assigned`, `in_progress`, `resolved`,
   `reopened`, `closed`.
   - They map one-to-one from ticket states, except that `submitted` and `triaging` are both
     `open`. A ticket change that maps to the same case state writes nothing.
   - Plan F4's "proposed resolved → under verification → closed/rework" already matches the
     existing `resolved` → `closed`/`reopened` steps, so no extra state is added yet.

### Locations, assets and evidence

5. **Locations are normalised by constraint.** Codes are stored in upper case (a check
   constraint rejects anything else), so the unique `(building, floor, room)` tuple is the
   normalised one.
   - A report's free-text building and room are matched to a location on code or building name,
     ignoring case and outer spaces.
   - An unmatched or ambiguous location is `UNKNOWN` (null): a wrong room on the heatmap is worse
     than an unknown one.
   - `private.locate_unknown_cases()` matches backfilled cases once the rooms exist, and logs an
     event for each.
6. **An asset is always in its case's room.** A composite foreign key `(asset_id, location_id)`
   enforces this in the schema. Assets carry administrator-maintained codes such as
   `PRJ-ENG-204`; there is no QR code (plan §01).
7. **`evidence_attachments`** holds photo metadata only. A row belongs to exactly one complaint
   or case. The table enforces:
   - JPEG, PNG or WebP only;
   - at most 2 MiB;
   - an object path of `<uploader id>/<attachment id>.<ext>`, so Storage policies in A1 can
     check ownership from the first folder.

   The image bytes never enter the database.

8. **`ai_jobs`** is the durable job record (plan §05):
   - a unique `dedupe_key`, so repeated enqueues collapse onto one job;
   - bounded `attempts`;
   - stable error codes, and `next_retry_at` exactly when a job waits for a retry.

   The pgmq queue and its consumer arrive in A1. `pgmq` and `vector` are enabled now (plan M1),
   so every environment is proven to support them before a feature depends on them.

### Access

9. **Read-only for every signed-in user, and scoped by role.**
   - Locations and assets are readable by signed-in users, like departments.
   - Cases, links and case history: admins see everything, and department staff see their
     department's cases.
   - Students see no operational records. Their complaint stays their view, and F4 will give
     reporters their own confirm/dispute action.
   - Photos are visible exactly when their complaint or case is. AI jobs are admin-only.
   - No role has INSERT, UPDATE or DELETE on any new table, and `case_events` is append-only
     even for the table owner. The schema-wide probes in `001_schema_guarantees` still pass
     unchanged, so no new RPC is open to signed-in users.

### Feature switches

10. **One switch per feature, all OFF by default** (`FEATURE_VISUAL_INSPECTION`,
    `FEATURE_DUPLICATE_DETECTION`, `FEATURE_MAINTENANCE_COORDINATOR`,
    `FEATURE_REPAIR_VERIFICATION`, `FEATURE_CAMPUS_HEATMAP`, `FEATURE_MAINTENANCE_INSIGHTS`).
    - A switch only exposes a feature. The AI step inside F1–F4 still needs `AI_ENABLED`, so
      turning AI off never breaks a feature that is on.
    - Vague values ("maybe") are refused at boot, as with `AI_ENABLED`.
    - `GEMINI_VISION_MODEL` defaults to `GEMINI_MODEL`, and `GEMINI_EMBEDDING_MODEL` defaults
      to `gemini-embedding-2`. That is Google's stable ID; it is set to 768 dimensions with
      `output_dimensionality` in A3.
    - The plan places these variables in A0, which overrides ADR 0001's "add a variable in the
      phase that reads it" for this case.

### Synthetic campus (A0.05)

11. **Reference data in the seed, history from a function.**
    - `seed.sql` adds 3 buildings × 2 floors × 6 rooms and 12 assets, idempotently.
    - `private.reset_synthetic_campus_history()` then replaces every `is_synthetic` case with the
      same 60 scenarios, timed relative to `now()`: a repeat-failure projector, a similarly
      named hard negative, a recent reopen, a long-unresolved case, an Engineering building
      cluster and an unknown room.
    - Cases opened by real reports are never touched.
    - The data is fictional, labelled synthetic, and resettable at any time ("re-runs safely and
      resets demo state").

## Rollback

Smallest step first, as in ADR 0007:

1. Leave the feature switches OFF (the default) and redeploy the previous app. Nothing in the
   app reads the new tables yet.
2. For a schema defect, ship a forward-only corrective migration.

Never drop the new tables as an emergency step (plan §16). The triggers only add rows, so even
a fault in them could only fail a ticket write loudly; it could never corrupt one. pgTAP and the
full E2E suite exercise every ticket write path with the triggers in place.

## Consequences

- Each ticket write now also writes one case row and one case event. That is a small
  per-request cost, inside the same transaction.
- Maintenance cleanup that deletes a complaint (service role, tests only) also removes its
  emptied case.
- A3 must add the case-led transition function and route linked complaints through it before
  any case can hold two reports.
