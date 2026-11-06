# Evidence: Add-on phase A4, F3 maintenance coordinator

**Gate A4 (plan v2 §14, §08):** a real agent tool call is visible and bounded; case status
remains correct under duplicate and stale jobs.

Design decisions: [ADR 0012](../adr/0012-maintenance-coordinator.md). Evaluation:
[a4-coordinator-eval.md](a4-coordinator-eval.md).

## Task checklist

| ID    | Task                                                             | Status | Evidence                                                                                                                      |
| ----- | ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| A4.01 | Case-aware read tools + proposal tool on the routing agent's way | Done   | `_shared/coordination` (tools, loop, adapter); four scoped `worker_*` read functions for the service role only                |
| A4.02 | Case version, controlled work-order create, uniqueness, policy   | Done   | `case_work_orders` (one active per case), `worker_finish_coordination`, `private.commit_work_order`, deterministic policy     |
| A4.03 | Human review queue and readable tool trace                       | Done   | "Work order" panel (proposal, reasons, Approve / Reject, trace in words); "Work orders awaiting approval" on the review queue |
| A4.04 | 25 scenario tests incl. injection, stale version, provider down  | Done   | `pnpm eval:coordination` (live) plus the stub-driven integration and E2E scenarios                                            |

Also covered:

- **F3.01:** unknown tools and malformed arguments are refused.
- **F3.02:** reads are scoped to the case, its equipment and its room; capacity is a count only.
- **F3.03:** atomic, version-checked commit; one active work order; append-only case event.
- **F3.04:** high-risk proposals wait for an administrator; Approve / Reject with an audit note.
- **F3.05:** run diagnostics (tools, ids, verdicts, timings, model, prompt version; no prompts or
  report text) and the `FEATURE_MAINTENANCE_COORDINATOR` switch.
- **F3.06:** the 25 scenarios, with the correct-routing rate and unauthorised attempts.
- **§12:** `POST /api/cases/[id]/coordinate` and `GET /api/cases/[id]/work-orders`.

## Verify clauses, as tested

| Plan clause                                                        | How it was shown                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown tool and malformed arguments are rejected (F3.01)          | Unit: an invented tool is refused and counted; bad arguments never reach a read. Integration (real worker + stub): `delete_case` is refused and recorded, and the case is routed normally                        |
| An agent cannot read another department's information (F3.02)      | Unit: reads of another case, other equipment or another room are refused. Integration: `STUB:COORD-SCOPE` is refused (`out_of_scope`). pgTAP: signed-in users cannot run any worker function                     |
| No arbitrary SQL or secret access (A4.01)                          | Six declared tools, mode `ANY` with an allow-list; no tool writes. pgTAP: API roles can only read the three new tables                                                                                           |
| Repeated commit never creates two work orders (F3.03, A4.02)       | pgTAP: finishing the same job twice returns the first result; a second active work order is a unique violation. Integration: two requests share one job, one run and one work order                              |
| High-risk cases cannot be committed automatically (F3.04, A4.03)   | pgTAP: a high-priority proposal waits even when the worker asks to commit. Integration and E2E: it waits until an admin approves; departments get `MR403`. Eval: no hazard, overload or repeat failure committed |
| Disable agent: manual routing still works (F3.05)                  | E2E (flag OFF): no panel, no queue section, both APIs 404, the routing form is there                                                                                                                             |
| Stale versions cannot create misassigned work orders (gate)        | pgTAP and integration: a case changed while the job waited supersedes the run; approving after a change retires the proposal (`stale`); an older page is `MR412`                                                 |
| Agent never changes roles or auto-closes cases (A4.04)             | No tool can; integration: injected instructions leave the case open and correctly routed. Eval: injected cases routed to the real fault                                                                          |
| Unavailable provider leaves the case routable by hand (§08 step 7) | Integration: `STUB:429` leaves the job in `retry_wait`, no run, the case `open`. Unit: 429/503/network errors are retryable                                                                                      |

## Live evaluation

25 scripted scenarios, live `gemini-3.1-flash-lite`, prompt `coordinator-v1`
([full report](a4-coordinator-eval.md)):

| Measure                                              | Result                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| Correct outcome (correct-routing rate)               | **25 / 25**                                   |
| Unauthorised attempts by the live model              | **0** (refusals proven with the stub instead) |
| High-risk or wrong proposals committed automatically | **0**                                         |
| Rationales claiming staff availability               | 0                                             |
| Live model calls                                     | 57 (2.4 per case)                             |

By kind: routine 8/8 (committed by policy), ambiguous 3/3 (handed to a person), hazard 3/3,
overloaded 2/2 and repeat failure 2/2 (held for approval or handed over), stale 2/2 (superseded),
injected instructions 4/4 (routed to the real fault; the injected department and priority were
ignored), provider down 1/1 (retryable, nothing recorded).

Honest reading:

- The live model never tried an unknown tool or another case's ids, so the refusal paths were
  not exercised live. They are proven by the stub-driven unit, integration and E2E tests, which
  script exactly those attempts.
- The first live attempt was cut short by the free tier (every call failed after 14 scenarios)
  and a second by the test's 30-minute limit. The harness now retries transient provider errors
  as the queue does and runs each scenario as its own test; the reported run needed no retries.
- 25 short synthetic cases and one run: a single scenario moves the rate by 4 points.

## Screenshots (local preview; photo, duplicate and coordinator features on; AI routing off)

| View                                                                                      | File                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Review queue: "Work orders awaiting approval" above the routing queue                     | [review-queue.jpg](a4/review-queue.jpg)                 |
| Admin: proposal with department, category, priority, reason and why a person must approve | [admin-proposal.jpg](a4/admin-proposal.jpg)             |
| Admin: Approve / Reject and the run's trace in words, with model and prompt version       | [admin-proposal-trace.jpg](a4/admin-proposal-trace.jpg) |
| Admin: a refused invented tool (`delete_case`) in red, then the committed work order      | [admin-refused-tool.jpg](a4/admin-refused-tool.jpg)     |
| Phone: after approval (page notice; work order "approved by an administrator")            | [mobile-approved.jpg](a4/mobile-approved.jpg)           |

The console had no errors, and the phone layout had no horizontal overflow.

## Local verification

Run on 2026-11-06 on `phase/a4-coordinator` after `supabase db reset`. The first E2E server has
every flag OFF; the second has the photo, duplicate and coordinator features on.

| Suite                        | Result                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm lint`                  | Pass, 0 warnings                                                                      |
| `pnpm typecheck` (tsc)       | Pass                                                                                  |
| `pnpm format:check`          | Pass                                                                                  |
| `pnpm test` (unit + DOM)     | **559 / 559** (27 new: loop, scope, budget, policy, prompt, adapter, handler, parity) |
| `pnpm db:test` (pgTAP)       | **495 / 495** in 12 files (42 new in `012_case_coordination`)                         |
| `pnpm test:integration`      | **137 / 137** (11 new: real worker + Gemini stub)                                     |
| `pnpm build`                 | Pass                                                                                  |
| `pnpm test:e2e` (Playwright) | **219 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed            |

New E2E journeys (`coordination.spec.ts`), on desktop Chromium and Pixel 7:

- an admin asks the coordinator, finds the proposal in the review queue, reads the trace and
  approves it; the department then sees its work order and its API (axe clean);
- an admin queues a run through the JSON API (202) and rejects the proposal;
- with the flag OFF there is no panel, no queue section and both APIs answer 404, while manual
  routing stays.

**Mutation check.** Removing the "case changed while the job waited" guard from
`worker_finish_coordination` makes the integration test "supersedes a run when the case changes
while it is queued" fail; restored afterwards.

**Bugs found while testing, fixed before the gate:**

- A stale proposal stayed `pending` forever: marking it stale was rolled back by the error raised
  right after. Approval now returns `stale` and keeps the marking.
- A change made while the job waited in the queue went unnoticed, because the worker loads the
  case when it runs. The job now carries the version it was asked for.
- On the AI server, triage's keyword fallback routed the E2E test report, so approving the
  proposal kept the existing work order. That is correct behaviour (ADR 0012), and the journey
  now uses a report that triage always leaves for a person (an injury).

**Not verified here:** the cloud. The migration, worker and flag are not pushed; that is A7 with
the owner's approval. Production is unchanged while `FEATURE_MAINTENANCE_COORDINATOR` is unset.
