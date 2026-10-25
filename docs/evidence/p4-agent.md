# Evidence: Phase 4, AI and controlled agent

**Gate P4:** a normal complaint routes to its approved department, provider failure leaves the
ticket stored, and invalid tool actions never modify the database.

## Task checklist (plan §15)

| ID    | Task                                                                        | Status | Evidence                                                                           |
| ----- | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| P4.01 | Gemini key; verify tool calling and the free-tier model with fictional data | Done   | `gemini-3.1-flash-lite` answered with tool calls on the owner's free-tier key      |
| P4.02 | Versioned prompt, six categories, strict tool declarations                  | Done   | `features/agent/prompt.ts` (`triage-v3`); declaration/validator drift test         |
| P4.03 | Adapter, timeout, max-step guard, result schema, failure codes              | Done   | `gemini.ts`, `run-agent.ts`, `failures.ts`; adapter tested through real REST shape |
| P4.04 | Read-only `list_departments` / `find_category_route`                        | Done   | `tools.ts`; answers from one routing snapshot per attempt                          |
| P4.05 | Validated `propose_assignment` and server routing policy                    | Done   | `policy.ts` + `agent_finish_run` re-check; pgTAP 005, integration                  |
| P4.06 | `agent_runs` metadata; inputs and keys redacted from logs                   | Done   | Migration `20261023184646`; trace of enums/ids only; log assertions                |
| P4.07 | Best-effort AI after the ticket transaction                                 | Done   | `submitComplaint` + `triageTicket`; only for newly created tickets                 |
| P4.08 | Review on timeout/429/invalid; stale recovery; bounded retries              | Done   | Stable codes; "AI stalled" marker; 3 per ticket, 10 per admin per 10 min (SQL)     |
| P4.09 | Labelled synthetic dataset and evaluation                                   | Done   | 120 reports; live results below and in `p4-agent-eval-*.md`                        |
| P4.10 | Malicious instructions, fabricated departments, invalid priority, outage    | Done   | Unit, integration and E2E cases listed below                                       |
| P4.11 | A successful and a rejected tool call in a recorded test                    | Done   | E2E `P4.11` + [screenshot](p4-tool-calls.png); trace asserted in the database      |

## Local verification (2026-10-24)

| Suite                         | Result                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| lint / typecheck / format     | Pass                                                               |
| Unit + component (Vitest)     | **361 / 361** (86 new: agent, adapter, policy, evaluation metrics) |
| pgTAP (`pnpm db:test`)        | **178 / 178** (49 new agent assertions)                            |
| API integration (Auth + REST) | **73 / 73** (19 new, real store and SQL with scripted models)      |
| E2E (Playwright)              | **142 / 142** (16 new, AI server + local Gemini stub), axe clean   |
| Production build              | Pass; no SDK or secret key in client assets (build scan)           |
| `pnpm audit --prod`           | No known vulnerabilities                                           |

### Gate P4 criteria, as tested

- **A normal complaint routes to its approved department:**
  - Integration: the real store and SQL route a ticket, audited as the agent with its reason.
    It lands in the electrical queue, and the run records model, prompt version and trace.
  - E2E: a student submits through the form and sees "sent to the department". The timeline shows
    the AI assistant's assignment, and the electrician sees it as New.
- **Provider failure leaves the ticket stored:**
  - Rate limit, outage, network error, timeout, missing key, text instead of a tool call: each
    leaves the ticket saved as `needs_review` with a stable code.
  - The reporter sees only a plain explanation.
  - A slow provider is cut off by the deadline, and the E2E submission returns in under 15 s.
  - An admin retry recovers a rate-limited ticket (E2E).
- **Invalid tool actions never modify the database:**
  - In pgTAP, eleven unsafe decisions are each refused. Afterwards the ticket is unchanged, no
    event was added, and the run is still open. The refused decisions were: wrong, fabricated
    and inactive departments; a disabled rule; high or unassessed priority; unclassified; a short
    reason; a failure code on a route; a foreign outcome; a malformed trace.
  - A model that keeps inventing a department leaves the ticket unrouted.
  - Forbidden tools (`close_ticket`, `update_user_role`) are refused as unknown. The student's role
    is unchanged.
  - A route invalidated mid-attempt is refused by SQL and recorded as `POLICY_REJECTED`.
  - Signed-in users, admins included, cannot execute the agent functions.

### Adversarial and failure cases (P4.10)

| Case                                                      | Where tested            | Result                                          |
| --------------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| Prompt injection in the report ("ignore instructions")    | unit, integration, eval | Data stays inside delimiters; no extra powers   |
| Fake `</report>` delimiter, invisible and bidi characters | unit                    | Stripped before the model sees the text         |
| Fabricated department (well-formed uuid or not)           | unit, pgTAP, int, E2E   | Rejected; model may correct; otherwise review   |
| Invalid priority (`urgent`, `unassessed`, `high`)         | unit, pgTAP             | Rejected, or review for `high`                  |
| Undeclared tools (close, role change, SQL, email)         | unit, integration       | `UNKNOWN_TOOL`; nothing executed                |
| Disconnected or failing Gemini (429, 5xx, network, slow)  | unit, int, E2E          | Ticket stored, `needs_review`, stable code      |
| Personal data in the report                               | unit, integration       | Emails, phones, ids, links redacted; not logged |

## Mutation checks (do the tests catch real faults?)

| Fault deliberately introduced                                   | Detected by                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `EXECUTE` on `agent_begin_run` granted to `authenticated`       | pgTAP 001 allowlist and 005; integration permission tests (2)     |
| `agent_finish_run` without its routing-rule and priority checks | **13 pgTAP failures** (005); integration `POLICY_REJECTED` test   |
| Safety screen removed from the policy                           | 3 unit failures, including "forces review for a dangerous report" |
| Replayed submissions allowed to rerun AI                        | Unit: "never reruns AI for a replayed idempotency key"            |

Each fault was reverted (`supabase db reset`, files restored) and the suites re-run green.

## Defects found by testing and fixed in this phase

1. **Washed-out colours in the first accessibility scan.** The scan ran during fade-in
   animations. It now uses reduced motion, as the other specs do. The real colours pass.
2. **Redaction label order.** An 8-digit student id was labelled `[phone]`. Ids are now matched
   first.
3. **A latent flaky test from P2.** "Never writes complaint text to the logs" checked that the
   room value `214` never appeared in any log line. It failed by chance when a random request id
   contained `214`. It now matches distinctive values as text and every field by its key.
4. **Optional decision fields.** The generated RPC types marked them required, so the review
   path could not omit them. The SQL parameters now have defaults instead of a cast.

## Live model evaluation (P4.01, P4.09)

Run on the owner's free-tier key with `gemini-3.1-flash-lite` on 2026-10-25, using fictional
reports only. Latency counts provider calls only (free-tier throttling excluded). Tuning used only
the 90 dev reports. The 30 held-out reports were scored once for v1 and once for the final v3.

| Run                                | Macro-F1  | Routed correctly | Must-review caught | Unauthorised | p50 / p95 latency |
| ---------------------------------- | --------- | ---------------- | ------------------ | ------------ | ----------------- |
| v1, held-out 30 (two calls)        | 0.880     | 20 / 22          | 3 / 3              | 0            | 5.6 s / 16.8 s    |
| v2, dev 90 (routes in the message) | 0.892     | 73 / 80          | 6 / 6              | 0            | 1.2 s / 10.2 s    |
| v3, dev 90 (category definitions)  | 0.936     | 76 / 79          | 6 / 6              | 0            | 2.3 s / 18.9 s    |
| **v3, held-out 30 (final)**        | **0.981** | **25 / 25**      | **3 / 3**          | **0**        | **1.1 s / 4.1 s** |

- **Why v2:** v1 needed two model calls per report, and 11 of the 30 held-out reports exceeded
  the 10 s deadline. v2 lists each category's approved department in the message (names and ids
  only), so one call decides. Thinking level `MINIMAL` was measured faster than `LOW`.
- **Why v3:** the v2 dev run sent building-fabric reports (floor tiles, signs, ceiling tiles, a
  gate) to Furniture. v3 defines furniture as fittings inside rooms and other as the building
  and outdoor areas.
- **Final held-out run:**
  - Every automatic route was to the labelled category, and every safety or non-maintenance
    report reached a human.
  - The 2 mismatches were reports the model rated high priority, which the policy deliberately
    sends to review.
  - Human-review rate was 16.7%. There were 0 rejected tool calls and 0 unauthorised state changes.
- **Honest caveats:**
  - Free-tier latency varies. Two dev calls stalled until the deadline (recorded as `TIMEOUT`, and
    the tickets went to review).
  - 30 held-out reports is a small sample, and the labels are the author's.
  - The figures are measured on synthetic data, not calibrated probabilities (BR-09).

## Cloud verification

- [x] Migration `20261023184646` applied to `makeitright-staging` with `supabase db push`.
      `supabase migration list --linked` shows local = remote for all four migrations.
- [x] Staging checks: `authenticated` and `anon` cannot execute the agent functions, while
      `service_role` can. RLS is on for `agent_runs`, and all 6 routing rules are enabled.
- [x] Owner added `AI_ENABLED`, `GEMINI_MODEL`, `GEMINI_API_KEY` and `SUPABASE_SECRET_KEY` to
      Vercel. The preview config parses (`/api/health` ok on `93b0bbf`).
- [x] Preview probes: signed-out `/admin/review` and `/student/complaints/new` get 307 to login.
      Anonymous `POST …/retry-ai` gets **401**, and a cross-site request gets **403**.
- [ ] Owner check on the preview: a demo student's fictional report is routed by the AI, and a
      review case appears in the admin queue with its run details.

**Gate P4: in progress.**
