# ADR 0012: Maintenance coordinator and work orders

- **Status:** Accepted
- **Date:** 2026-11-05
- **Phase:** A4 (Advanced Features add-on, F3)

## Context

Plan v2 §08 (F3.01–F3.06) and phase A4 ask for a case-aware coordinator:

- one bounded agent that reasons over a case and asks for allowed tools;
- mutations only through typed, authorised application functions;
- one active work order per case, committed once, against the case version;
- high-risk proposals approved by a person, with a readable tool trace;
- 25 scenario scripts reporting the correct-routing rate and unauthorised-action attempts.

**Gate A4:** a real agent tool call is visible and bounded; case status stays correct under
duplicate and stale jobs.

## Decisions

### Work orders

1. **`case_work_orders` holds which department works a case.**
   - A partial unique index allows one `active` work order per case; history is kept
     (`completed`, `cancelled`).
   - `source` records who made it: `ticket_routing`, `coordinator` (low risk, committed by
     policy) or `admin_approved` (with its `proposal_id`).
2. **A trigger keeps it in step with the case**, so every existing path (manual routing, the
   triage agent, shared-case sync) maintains work orders without being changed:
   - a new department ends the active work order and starts one;
   - closing the case completes it; merging or unrouting cancels it.
     The coordinator's commit sets its source through a transaction-local setting. Existing open,
     routed, real cases were backfilled.
3. **Everyone who can see the case can see its work orders** (RLS on the case). Runs and
   proposals are for administrators only.

### The bounded loop (F3.01–F3.02)

4. **A queued job, not a request.** `request_case_coordination` (admin, or the department that
   holds the case, per §12) queues one `coordination` job.
   - The job records the case version it was asked for (`ai_jobs.target_version`, plan §08
     `COORDINATION(case_id, expected_version)`); repeated requests for the same version return
     the same job.
   - Synthetic history is never coordinated. Each case gets at most five runs a day (`MR429`):
     every run is a paid model call.
5. **Six declared tools, none of which writes:**
   - four reads: `get_case_context`, `get_asset_repair_history`, `get_department_capacity` and
     `find_related_cases`;
   - two final tools: `propose_work_order` and `request_admin_review`.

   There is no `commit_approved_work_order` tool. The plan lists it as a server-only mutation,
   so it is a database function the model cannot name.

6. **Code authorises every call.** Gemini runs with manual function calling: mode `ANY`, with an
   allow-list of the six names. Every call is then checked by the worker:
   - the name against the six tools, and the arguments against a strict Zod schema;
   - the scope: only this case, its own equipment and its own room.

   Unknown tools and out-of-scope ids are refused, counted as unauthorised attempts, recorded in
   the trace and explained to the model. Malformed arguments are refused the same way. At most
   four reads and six turns are allowed, inside the queue's time limit. A run that never decides
   ends in review (`STEP_LIMIT`).

7. **The reads are scoped SQL functions for the service role**, returning ids, counts and
   categories only. Capacity is a count of active work orders; no staff names or availability
   are ever read. The model sees the reports sanitised (identifiers redacted) and fenced; text
   inside them is data, never instructions.
8. **A proposal must name the approved route** for its category (the routing rules). A wrong
   department is refused with the right one named, and the model may correct itself within its
   budget.

### Approval and commit (F3.03–F3.04)

9. **A deterministic policy, not the model, decides who commits.** A proposal needs a person
   when any of these hold:

   | Reason                  | When                                                       |
   | ----------------------- | ---------------------------------------------------------- |
   | `HIGH_PRIORITY`         | the proposal or the case is high priority                  |
   | `SAFETY_SIGNAL`         | the triage safety screen flags the reports (same patterns) |
   | `REPEAT_FAILURE`        | the equipment had 3 or more cases in 30 days               |
   | `DEPARTMENT_OVERLOADED` | the department already has 10 or more active work orders   |
   | `REASSIGNMENT`          | it would move the case to another department               |
   | `CATEGORY_CHANGE`       | it would change a classified case's category               |
   | `SHARED_CASE`           | the case covers several reports                            |

   Load and history come from the database, never from the model's claims.

10. **`worker_finish_coordination` records the run and applies the rules again**, in one
    transaction:
    - it locks the job (attempt token) and records one run per job, so a retried or duplicated
      job returns the first result;
    - a case that changed since the request or the run (version) supersedes the run;
    - it re-checks the route, and adds `HIGH_PRIORITY` itself;
    - only a proposal with no reasons commits (`coordinator`); anything else waits as `pending`.
      A newer proposal retires an older pending one.
11. **Committing** (`private.commit_work_order`) re-checks the version, then updates the case
    (department, category, priority, status `assigned`) and writes an `assigned` case event.
    Every linked ticket follows through the A3 case-led sync.
12. **`admin_decide_proposal` is the human approval.** It approves against the case version the
    admin saw, or rejects; an optional note is kept for the audit trail.
    - It returns `committed`, `rejected` or `stale`.
    - A case that changed after the proposal retires it as `stale` (kept, not raised, so the
      marking survives).
    - A page older than the case is `MR412` and changes nothing.

    Admin override stays the existing manual routing form. The coordinator never closes cases,
    changes roles or touches anything but the routing of its own case.

### Interface and diagnostics (F3.04–F3.05)

13. **One "Work order" panel on the ticket page**, behind `FEATURE_MAINTENANCE_COORDINATOR`:
    - the active work order and its source;
    - for admins: the pending proposal with its reasons, Approve / Reject, and the last three
      runs. Each run's trace is in words ("Checked a department's open work orders: done"),
      with refusals in red, the model and the prompt version;
    - for departments: the work order and "Ask the coordinator".
14. **The review queue lists proposals awaiting approval**, oldest first, linking to the ticket.
15. **The trace holds tool names, ids, enums, verdicts and timings only**; never the rationale,
    report text or prompts (as in ADR 0005).
16. **APIs (§12):**
    - `POST /api/cases/[id]/coordinate` (admin or holding department; 202 with the job id);
    - `GET /api/cases/[id]/work-orders` (admin or holding department; a hidden case is 404).
17. **Switching the flag off** hides the panel, the queue section and the APIs (404). Manual
    routing and AI triage are untouched.

### Evaluation (F3.06, A4.04)

18. **25 scenario scripts** (`tests/eval/coordination/scenarios.ts`), run by
    `pnpm eval:coordination` against the live model with the worker's own loop, policy and
    adapter:
    - routine 8, ambiguous 3, hazard 3, overloaded 2, repeat failure 2;
    - stale 2 and provider unavailable 1, decided by code;
    - injected instructions 4.

    Results are in `docs/evidence/a4-coordinator-eval.md`.

## Consequences

- The coordinator runs when someone asks for it; it does not replace triage routing. Running it
  automatically for every case that needs review is a later choice, once real usage shows its
  value.
- A case already routed to the proposed department keeps its `ticket_routing` work order when a
  proposal is approved: the work order says who works the case, and that did not change. The
  approval is still recorded on the proposal and the case timeline.
- Each run costs 2–4 model calls. With the 5-a-day cap, a case costs at most about 20 calls a day.
- Deploying needs no new secrets: the worker uses `GEMINI_MODEL` (default
  `gemini-3.1-flash-lite`) like the photo analysis. Cloud rollout is A7.
