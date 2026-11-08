# 02. Complete user manual

This manual follows the real screens. Each operation is written as:

**Action → What you see → What the server does → What changes in the database → AI involvement**

Status labels are explained in the [README](README.md). Anything marked **Built, switched off in
prod** works on the rehearsal preview (`makeitright-git-main-takeasy1.vercel.app`) but not on the
production site until its `FEATURE_*` switch is turned on there.

Page list (from `src/app`):

| Area    | Path                                                         | Who                | Status                                                         |
| ------- | ------------------------------------------------------------ | ------------------ | -------------------------------------------------------------- |
| Public  | `/`                                                          | Anyone             | Live                                                           |
| Auth    | `/login`, `/signup`, `/forgot-password`, `/account/password` | Anyone / signed in | Live                                                           |
| Student | `/student/complaints`                                        | Student            | Live                                                           |
| Student | `/student/complaints/new`                                    | Student            | Live                                                           |
| Student | `/student/complaints/[id]`                                   | The reporter       | Live                                                           |
| Staff   | `/department`, `/department/[id]`                            | Department staff   | Live                                                           |
| Admin   | `/admin`                                                     | Admin              | Live                                                           |
| Admin   | `/admin/tickets`, `/admin/complaints/[id]`                   | Admin              | Live                                                           |
| Admin   | `/admin/review`                                              | Admin              | Live                                                           |
| Admin   | `/admin/departments`                                         | Admin              | Live                                                           |
| Admin   | `/admin/jobs`                                                | Admin              | Built, switched off in prod (shown when a queue feature is on) |
| Admin   | `/admin/heatmap`                                             | Admin              | Built, switched off in prod                                    |
| Admin   | `/admin/insights`                                            | Admin              | Built, switched off in prod                                    |

Access is checked on every page by `requirePageAccess` in
[`src/features/auth/session.ts`](../../src/features/auth/session.ts). Visiting another role's area
sends you to your own.

---

## A. Student

### A1. Opening the website

**Action:** open <https://makeitright-takeasy1.vercel.app>.
**You see:** the landing page: what the system does, how it works, "AI and safety", and "Report an
issue" / "Sign in" buttons.
**Server:** a static, prerendered page served from Vercel's CDN.
**Database:** nothing.

### A2. Creating an account

**Action:** `/signup`. Enter **Full name**, **Email**, **Password** (at least 10 characters).
**You see:** a message that a confirmation email was sent if the address can be used. The wording
is the same whether or not the address exists (no account enumeration).
**Server:** a server action validates with Zod
([`src/features/auth/schemas.ts`](../../src/features/auth/schemas.ts)) and calls Supabase Auth.
**Database:** Supabase creates the user in `auth.users`. A trigger creates a `profiles` row with
the role **student**, always. A role written into sign-up data is ignored.
**AI:** none.

The free Supabase email sender allows only a few emails per hour. For the expo, use the seeded demo
accounts instead of signing up ([ADR 0007](../adr/0007-production-release.md)).

### A3. Signing in

**Action:** `/login`, enter email and password.
**You see:** your dashboard (`/student/complaints`).
**Server:** Supabase Auth checks the password and sets session cookies (`HttpOnly`,
`SameSite=Lax`). There is no Supabase client in the browser, so page scripts cannot read the
session token. On each request, [`src/proxy.ts`](../../src/proxy.ts) refreshes the session and
the page re-verifies it and reads your role from `profiles`.
**Database:** reads `profiles`.
**Failure:** a wrong password and an unknown email give the same message.

"Forgot password" sends a reset link (`/forgot-password`), and `/account/password` sets a new one.

### A4. The student dashboard

**You see** ("Hi …, here are your reports"):

- three counters: **Open**, **Awaiting your confirmation** (resolved, waiting for you), **Closed**;
- a search box ("Title, place or MIR-1234") and filters **All / Open / Resolved / Closed**;
- a table: reference, title and place, status, date reported.

**Server:** `list_complaints()` runs as you (`SECURITY INVOKER`), so row-level security returns
only your own reports. Pages hold 20 rows (maximum 50) with a keyset cursor.
**Database:** reads `complaints`.

### A5. Submitting a report

**Action:** **Report an issue**. Fill in:

| Field                | Rule                        |
| -------------------- | --------------------------- |
| What is wrong?       | 5–120 characters            |
| Describe the problem | 15–3,000 characters         |
| Building             | 2–80 characters (free text) |
| Room (optional)      | up to 40 characters         |

The student does **not** pick a category or department. That is the AI's (or an admin's) job.

**Action:** **Submit**.

**You see:** a pending state for up to about 10 seconds (the AI attempt), then your report page
with "We have your report" and its reference, for example `MIR-1020`.

**Server**, in order ([`src/features/complaints/service.ts`](../../src/features/complaints/service.ts)):

1. Validate with Zod. Unknown fields are rejected, not ignored.
2. Call `create_ticket()` with an idempotency key that the form rendered once. A double click
   or a retried request returns the same ticket.
3. **AI triage** (if `AI_ENABLED=true`): the model proposes a route; rules check it; the database
   checks it again. See [document 3](03-feature-by-feature-explanation.md#b1-ai-ticket-routing).
4. If duplicate detection is on: queue an `embedding` job (best effort; it cannot fail the
   submission).

**Database**, in one transaction for step 2:

- `complaints` gets the row (status `submitted`, `version` 1, a `reference_no` from an identity
  column starting at 1001, shown as `MIR-1001`);
- `submission_keys` stores your key with a SHA-256 of the content;
- `ticket_events` gets a `created` event;
- a trigger opens a `maintenance_cases` row (shown as `MC-5xxx`) and links the report in
  `case_reports`, and tries to match your building and room text to a known room.

**Limits:** 20 reports per student per 10 minutes (`MR429` → HTTP 429).

### A6. Choosing building and room

Building and room are **free text**. The database matches them to a known room when the text
equals a room code or building name, ignoring case and outer spaces (for example "Engineering
Block" + "LAB-204"). Anything unmatched or ambiguous stays **location unknown**; staff or an admin
can place it later with the location picker (F5). A wrong room on the heatmap is considered worse
than an unknown one ([ADR 0008](../adr/0008-maintenance-foundation.md)).

### A7. Adding a photo — F1, **Built, switched off in prod**

**Action:** on your report page, **Photos → Add a photo**. JPEG, PNG or WebP, up to 2 MB.
**You see:** "Preparing upload… → Uploading photo… → Checking photo…", then the photo with
"Analysing…". Within about a minute or two the **AI observation** appears.
**Server:**

1. `POST /api/complaints/[id]/photos` reserves a row and gets a signed upload URL.
2. Your browser uploads the file **directly** to private Supabase Storage (not through Vercel).
3. `POST /api/complaints/[id]/photos/finalize`: the server downloads it, checks the size, the
   real file signature (magic bytes) and the SHA-256, then finalizes.

**Database:** `evidence_attachments` row `pending` → `finalized`; an `ai_jobs` row
(`visual_analysis`) and a queue message are created in the same transaction.
**AI:** the background worker sends the image and your report to Gemini and stores a structured
answer in `visual_analyses`.

The page re-reads itself every 8 seconds for about two minutes. Leaving and coming back loses
nothing.

### A8. Reading the AI observation

The card says **"AI observation — A suggestion, not a finding. It may be wrong."** and shows:

| Row                | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| Visible            | Things the model says it can see                                                 |
| Possible issue     | Its cautious guess at the problem                                                |
| Suggested category | One of the six categories, or unclear                                            |
| Severity hint      | low / medium / high                                                              |
| Not visible        | What a photo cannot show (cause, inside of a cabinet, whether it works)          |
| Why                | A short explanation                                                              |
| Flags              | e.g. "Part of the problem cannot be seen", "blurry", "does not match the report" |

**Action:** **Looks right** (confirm) or **Something is wrong** (dispute; a note is required).
**Database:** an append-only row in `visual_analysis_reviews`. The analysis itself never changes,
and neither does the ticket's category or routing. At most 10 responses per person per analysis.

### A9. How statuses change

| Status         | Meaning to the student                 | Who moves it there       |
| -------------- | -------------------------------------- | ------------------------ |
| `submitted`    | Saved, not yet routed                  | You, by submitting       |
| `triaging`     | The AI is working on it                | The system               |
| `needs_review` | An administrator will route it         | The AI or the rules      |
| `assigned`     | A department has it                    | The AI route or an admin |
| `in_progress`  | Work has started                       | Department staff         |
| `resolved`     | Staff say it is fixed; waiting for you | Department staff         |
| `reopened`     | You said it is still a problem         | You                      |
| `closed`       | You confirmed the fix                  | You (or an admin)        |

The allowed moves live in one table, `private.ticket_transitions`
([migration](../../supabase/migrations/20261023140440_ticket_workflow.sql)).

### A10. How students get updates

There are **no email or push notifications** (Not built). A student sees updates by opening their
dashboard or report page: the status badge, the "Assigned to" department, and the **History**
timeline, which lists each event with the actor's role ("Reporter", "AI assistant",
"Department staff", "Administrator") and the time.

### A11. Confirming or disputing the fix

When the status is `resolved`, the report page asks **"Is it fixed?"**

- **Yes, it is fixed** → `closed`. The event reads "Closed: fix confirmed".
- **No, it is still a problem** → asks "What is still wrong?" (at least 5 characters) →
  `reopened`. The department is asked to look again.

**Server/database:** `transition_ticket()` checks you are the reporter, locks the row, checks the
version, bumps it and appends the event.
With F4 on, the same buttons also settle the open repair verification.

### A12. When the issue is not fixed

A reopened ticket returns to the department's queue. Staff move it `reopened → in_progress →
resolved` again, and you are asked again. Nothing is lost: notes, photos and history are kept.

### A13. History

The **History** card is the audit trail. Events are append-only: a database trigger rejects any
update to `ticket_events`, even from the table owner.

---

## B. Department staff

### B1. Signing in and the queue

Staff accounts are created by script with a department (for example
`it.staff@makeitright.test` in IT Services). After sign-in you land on **Department queue**
(`/department`).

**You see:** your department's active tickets, oldest first by default, with a **New** marker
until acknowledged, filters by status, search, and sorting (newest, oldest, priority).
**Database:** row-level security returns only tickets whose `department_id` is yours.

### B2. Acknowledging

**Action:** open a ticket → **Acknowledge**.
**You see:** "Acknowledged. The reporter can see that the department has the ticket."
**Database:** `acknowledge_ticket()` sets `acknowledged_at` once per assignment, appends an event,
bumps the version. Reassignment clears it so the new department acknowledges again.

### B3. Starting work

**Action:** **Start work** → `in_progress` (from `assigned` or `reopened`).

### B4. Adding a work note

**Action:** **Work note** → **Add note**. Notes are recorded on the timeline but do not change the
ticket's status or version.

### B5. Resolving

**Action:** **Mark resolved** → asks **"What was done?"** (at least 5 characters) → `resolved`.
Staff **cannot close** a ticket; only the reporter (or an admin) can.

### B6. Viewing the reporter's photos — F1, **Built, switched off in prod**

The **Photos** box is the last box in the right-hand column of the ticket page. Staff see the
photo and the AI observation but cannot respond on the reporter's behalf.

### B7. Repair photos — F4, **Built, switched off in prod**

**Action:** **Repair verification → Add a before photo / Add an after photo**.
Allowed while the case is `assigned`, `in_progress`, `reopened` or `resolved`, at most 12 photos
per case, only by the department holding the case or an admin.
**After an after photo:** a `repair_verify` job compares it with the before photo (the latest staff
before photo, or else the first photo a reporter attached). The panel shows **Photo comparison**:
"Looks improved", "May not be fixed", "Inconclusive" or "Not comparable", with visible changes,
what cannot be seen, and "Photo comparison only: no functional test was done."
Staff **cannot** confirm their own repair (`MR403`).

### B8. Shared cases and duplicates — F2

When an admin links several reports into one case, a change by staff on any of the linked tickets
(start, resolve) is copied to the others as a system event ("Updated with the shared case MC-…").
Staff see **Possible duplicates** for their own reports but cannot link; only admins decide.

### B9. Asking the coordinator — F3, **Built, switched off in prod**

The department holding a case can click **Ask the coordinator** in the **Work order** panel. It
queues a job; the result appears after the worker runs (about a minute). Staff see the work order,
not the admin's approval controls.

### B10. Setting room and equipment — F5

The location picker lets staff (for their department's cases) or admins set the case's room and
equipment, for example `PRJ-ENG-204`. Equipment in another room is refused. This is what makes a
case count on the heatmap and in repeat-failure alerts.

### B11. Restrictions

- Only your department's tickets are visible; others answer "not found", never "forbidden".
- You cannot assign or reassign tickets, close them, change roles, or decide duplicates.
- If someone else changed the ticket first, you get "This ticket changed" (HTTP 409) with a
  refresh link instead of overwriting their change.

---

## C. Administrator

### C1. Overview (`/admin`)

From `admin_metrics(window)` ([ADR 0006](../adr/0006-admin-operations.md)), for 7, 30 or 90 days:

| Block       | What it shows                                                                     |
| ----------- | --------------------------------------------------------------------------------- |
| Totals      | All tickets, open tickets, created in window, closed in window                    |
| Routing     | Awaiting routing, needs review, **AI stalled** (stuck in triage over 2 minutes)   |
| Status      | Count in each of the 8 statuses                                                   |
| Ageing      | Open tickets under 1 day, 1–3, 3–7, over 7 days; oldest open in hours             |
| Resolution  | Resolved in window; median hours to resolve                                       |
| Per day     | Tickets created in each of the last 14 days                                       |
| Departments | For each: open, unacknowledged, in progress, resolved in window, active or not    |
| AI          | Runs, routed, needs review, superseded, running, p50/p95 duration, review reasons |
| Accounts    | Number of students, staff and admins                                              |

Charts are server-rendered HTML with the same numbers in lists, so they work without JavaScript
and with screen readers.

### C2. All tickets (`/admin/tickets`)

Every ticket, with status filters, search and sorting. Opening one goes to
`/admin/complaints/[id]`.

### C3. The admin ticket page

Left: details and history. Right column (each box only when its feature is on):

- **Route this ticket** (assign form): category, department, priority, note. Pre-selects the
  category's default department. Uses `assign_ticket()`.
- **Workflow buttons**: an admin can make any move any role can, recorded under the admin's role.
- **AI routing attempts**: each run's outcome, steps (tool names, verdicts, codes), duration, and
  "continued on the backup model" when the primary was overloaded. **Retry AI routing** runs one
  more attempt (at most 3 attempts per ticket; at most 10 admin retries per 10 minutes).
- **Repair verification** (F4), **Work order** (F3), **Possible duplicates** (F2),
  **Room and equipment** (F5; choose the room and equipment, then **Save location**), **Photos** (F1).

### C4. Review queue (`/admin/review`)

Everything a person must decide, oldest first: `submitted`, `triaging` and `needs_review` tickets
(with "AI stalled" flags), and, with F3 on, **proposals awaiting approval**. "All caught up" when
empty.

### C5. Duplicate review — F2, **Built, switched off in prod**

On a ticket with candidates, **Possible duplicates** lists up to 5 earlier cases with a score and
**Why it was suggested** (similar wording, same room, same building, category compatible, same
equipment).

- **Same problem: link** → the report joins that case (version-checked).
- **Different problem** → rejects that candidate only.
- **Keep as a separate case** → rejects all pending candidates.

Details in [document 3, F2](03-feature-by-feature-explanation.md#f2-duplicate-detection).

### C6. Work orders and approvals — F3, **Built, switched off in prod**

The **Work order** panel shows the active work order and its source (`ticket_routing`,
`coordinator`, `admin_approved`). **Ask the coordinator** queues a run. If the policy requires a
person, you see **Proposal waiting for your approval** with **Why a person must approve it**
(e.g. "shared case", "possible hazard"), an optional note, **Approve work order** and **Reject**.
**Coordinator runs** shows the last three runs with their **Tool calls** in words.

A low-risk proposal (single report, normal priority, no hazard, department not overloaded, no
reassignment) is **committed automatically**, so no Approve button appears. That is the designed
behaviour.

### C7. Departments (`/admin/departments`)

- **Availability:** switch a department active or inactive. If routing rules point to an inactive
  department, those categories go to the review queue.
- **Routing rules:** which department handles each category, and whether the rule is enabled.
- **Change history:** every change with the admin, entity, before and after values, from the
  append-only `config_changes` table.

### C8. AI jobs (`/admin/jobs`) — **Built, switched off in prod**

Recent background jobs (photo analysis, embeddings, duplicate matching, coordination, repair
comparison) with filters: queued, running, waiting to retry, succeeded, needs review. Each failure
has a plain-language reason. **Retry** re-queues a job in review (at most 3 times per job, with a
fresh attempt budget).

### C9. Campus heatmap (`/admin/heatmap`) — F5, **Built, switched off in prod**

One floor plan (SVG) per building floor; each room is coloured by a severity-weighted count of
distinct cases (low 1, medium 2, high 3), in five steps relative to the busiest room in view.
Filters: **Opened in** (7/30/90 days), building, floor, category, department, status (all, still
open, resolved or closed), and **Include labelled demo cases / Real cases only**. Clicking a room
(or Tab + Enter) lists its cases. A table repeats every number, and cases with no known room are
counted as "location unknown".

### C10. Insights (`/admin/insights`) — F6, **Built, switched off in prod**

- **Alerts** from four rules (repeat failure, recent reopen, building cluster, long unresolved),
  each with its evidence cases, window and metric. **Acknowledge** with a note; an acknowledged
  alert stays listed until its rule stops holding.
- **Equipment ranked by cases** (90 days), **Cases per week** chart with a table.
- **Response-time targets** per category, editable.
- **Refresh now** re-runs the rules (they also run daily at 02:20).

### C11. What admins cannot do in the app

- Change a user's role (script only).
- Unlink a report from a shared case.
- Edit or delete history.
- Switch features on or off (that is a Vercel variable plus a redeploy).

---

## D. Full walkthrough: "The projector in Computer Lab 204 is not working"

This uses the seeded campus: Engineering Block, room `LAB-204`, projector `PRJ-ENG-204`.

| #   | Step                   | What happens inside                                                                                                                                                                                                                                  | Status                            |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Student submits        | Zod validation → `create_ticket()` in one transaction: complaint, idempotency key, `created` event; trigger opens case `MC-…` and matches "Engineering Block"/"LAB-204" to the room                                                                  | Live                              |
| 2   | Storage                | Row in `complaints` (`MIR-…`, version 1); `case_reports` links it to its case                                                                                                                                                                        | Live                              |
| 3   | AI routing             | `agent_begin_run` (service role) → Gemini with four tools → `propose_assignment(it_equipment, IT Services, medium)` → policy check → `agent_finish_run` re-checks and assigns. Status `assigned`, event "AI assistant"                               | Live (needs `AI_ENABLED`)         |
| 4   | Photo                  | Student adds `projector-lab204-before.png`: reserve → direct upload → byte check → finalize → `visual_analysis` job                                                                                                                                  | Built, switched off in prod       |
| 5   | Image analysis         | Worker re-checks the bytes, sends image + sanitised report to Gemini with a JSON schema; stores e.g. "blue screen with warning triangle", IT equipment, low, "Part of the problem cannot be seen"                                                    | Built, switched off in prod       |
| 6   | Duplicate check        | `embedding` job → 768-number vector → `duplicate_match` job compares with open cases in the same building from the last 30 days                                                                                                                      | Built, switched off in prod       |
| 7   | Second student reports | Same projector, different words → candidate with score ≥ 0.82 → admin clicks **Same problem: link** → one shared case, two reports                                                                                                                   | Built, switched off in prod       |
| 8   | Coordinator            | Admin asks the coordinator → reads the case, equipment history, department load → proposes IT Services → policy finds `SHARED_CASE` (and `REPEAT_FAILURE` if the equipment is set and has 3+ cases in 30 days) → waits for approval → admin approves | Built, switched off in prod       |
| 9   | Staff work             | IT staff acknowledge → start work → note → mark resolved ("Replaced the lamp"); the shared case copies the change to the second report                                                                                                               | Live (sharing: switched off)      |
| 10  | Before/after evidence  | Staff upload an after photo (`projector-lab204-after.png`) → `repair_verify` job                                                                                                                                                                     | Built, switched off in prod       |
| 11  | Repair verification    | Gemini compares both photos → "Looks improved", flags, "no functional test" → suggestion only, no status change                                                                                                                                      | Built, switched off in prod       |
| 12  | Student confirmation   | Each reporter clicks **Yes, it is fixed** for their own report → their ticket closes → the review is settled `confirmed`                                                                                                                             | Live (review: switched off)       |
| 13  | Case completion        | The case closes when its last report closes; its work order is completed by trigger                                                                                                                                                                  | Live                              |
| 14  | Dashboards             | Overview counts update immediately (live SQL); heatmap reads cases live; insight alerts update at the next refresh (daily or **Refresh now**)                                                                                                        | Overview live; F5/F6 switched off |

What is **not** part of this journey: no notification is sent at any step; the AI never closes
anything; nothing is linked or approved without a person, except low-risk coordinator commits
that the policy allows.
