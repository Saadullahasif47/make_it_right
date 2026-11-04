# ADR 0005: Bounded AI triage with a privileged routing adapter

- **Status:** Accepted
- **Date:** 2026-10-24
- **Phase:** P4

## Context

Plan §8 lets one model classify a sanitised report and propose a department through a few
declared tools. Application code decides; the model is never the source of truth. Plan §9 requires
agent routing to go through a server-only privileged adapter, "never a student-callable
route_ticket RPC", so that ordinary authenticated clients have no EXECUTE on that path.

**Gate P4:** a normal complaint routes to its approved department, provider failure leaves the
ticket stored, and invalid tool actions never modify the database.

## Decisions

### Where the agent may write

1. **Two service-role functions:** `agent_begin_run` and `agent_finish_run` are the agent's only
   writes, and only `service_role` may execute them.
   - Signed-in users, admins included, get "permission denied". pgTAP, integration and E2E all
     assert this.
   - The `001` allowlist fails if anyone ever grants them to `authenticated`. A mutation test
     proved it does.
2. **The secret key goes on the server.** `SUPABASE_SECRET_KEY` becomes a server-only variable on
   Vercel, marked Sensitive. This supersedes the P1 note that the application never reads it.
   - A key a student cannot hold is the only way to make the path non-student-callable. Anything
     the server can do with the student's own token, the student can do directly.
   - Containment:
     - Lint allows `@/lib/supabase/privileged` only inside `src/features/agent`.
     - The client calls those two functions and reads the routing reference data, nothing else.
     - The config module refuses a publishable key in this slot, and a build scan confirms the key
       is not in any client asset.
3. **The server proves the original request.** `agent_begin_run` takes the verified session user:
   - A submission attempt must come from the ticket's reporter, on a `submitted` ticket with no
     earlier run. A replayed idempotency key therefore never reruns AI (plan §4 step 7).
   - An admin retry is re-checked as admin from `profiles`.

### Defence in depth for every decision

4. **Validation, then policy.** Each tool argument is validated with a strict Zod schema; unknown
   tools and extra keys are refused. `propose_assignment` then goes through a pure policy:
   - The department must be the enabled, active default for the category in `routing_rules`.
     Otherwise the model is told why and may correct itself within its budget.
   - A category with no route goes to review.
   - A report the deterministic safety screen flags goes to review (BR-08).
   - High priority always goes to review. The model may recommend urgency but never trigger it.
5. **The database checks again.** `agent_finish_run` re-applies the same rules. A refused decision
   raises, so nothing is written, and the adapter then records the run as `POLICY_REJECTED`. An
   integration test disables a rule mid-attempt to prove this path.
6. **No overwriting people.** If the ticket changed while the model was working (an admin routed
   it, or a retry took over), the run is recorded as superseded (`TICKET_CHANGED`) and the
   ticket is left exactly as they left it.

### Bounded, auditable execution

7. **Bounds and failure codes.**
   - One invocation, at most three tool exchanges, one deadline for the whole attempt
     (`AI_TIMEOUT_MS`, default 10 s), 1,024 output tokens, and tool-only calling mode.
   - SDK retries are off: a failed attempt goes to review, and further attempts are an admin
     decision.
   - Every outcome has a stable code: `TIMEOUT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
     `PROVIDER_REJECTED`, `INVALID_OUTPUT`, `STEP_LIMIT`, `SAFETY_REVIEW`, and the others in
     `failures.ts`.
8. **Bounded retries, stored in the database.**
   - At most three attempts per ticket and ten admin retries per ten minutes, enforced in SQL.
   - An attempt stuck in `triaging` for more than two minutes (its function stopped after commit)
     can be taken over and is marked `ABANDONED`. The review queue flags it as "AI stalled".
9. **Privacy.**
   - The model receives only the title and description, with emails, phone numbers, ids and links
     replaced by placeholders, inside delimiters the report cannot fake.
   - `agent_runs` stores the model, prompt version, outcome, code, duration and a trace of tool
     names, enum arguments and verdicts. It never stores prompts or report text. Logs follow the
     same rule.
   - Reporters see only a plain explanation, never provider details.
10. **Honest labelling.** Agent events are shown as "AI assistant", and the prompt version is
    stored on every run. With `AI_ENABLED=false` nothing is attempted, and tickets wait for manual
    routing exactly as in Phase 3. A deterministic fallback, if one is added later, must be
    labelled rule-based routing (plan §8).
11. **Prompt evolution was measured, not guessed.** Every version ran on the real model. Changes
    were tuned on the 90 dev reports only; the 30 held-out reports were scored for v1 and v3 (once
    each), never used for tuning.
    - `triage-v1`: lookup, then propose (two calls). Held-out p95 latency was 16.8 s, above the
      10 s deadline.
    - `triage-v2`: the user message lists each category's approved department (names and ids
      only, allowed by plan §8), so the model decides in one call. The lookup tools remain.
    - `triage-v3`: sharper furniture vs other definitions after the dev run confused the two.
    - Thinking level `MINIMAL`: measured faster than `LOW`, with the same tool call.

### Testing without a live provider

12. **Three levels of stand-in.**
    - A provider-neutral `ModelClient` interface is implemented by the Gemini adapter and, in
      tests, by scripted models.
    - Unit tests drive the real adapter through an injected `fetch`, checking the exact REST
      request (tool-only mode, declarations, thought-signature echo) and one HTTP attempt on 429.
    - E2E runs a second production server against a local stateless Gemini stub
      (`GEMINI_BASE_URL`). The config refuses that variable on any deployment and accepts only
      loopback addresses.
13. **Live evaluation is opt-in.** `pnpm eval:agent` evaluates 120 labelled synthetic reports.
    The 30 held-out ones are the default, and the free-tier quota is respected. The report is
    written to `docs/evidence/p4-agent-eval-<prompt version>-<split>.md`.

## Consequences

- **Deployment needs three Sensitive server variables:** `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`
  and `AI_ENABLED=true`. If `AI_ENABLED=true` but the secret key is missing, tickets stay
  `submitted` (still in the review queue) and an error is logged. If the Gemini key is missing,
  each attempt is recorded as `PROVIDER_NOT_CONFIGURED` and the ticket waits for review.
- **Submitting waits for the AI attempt,** up to the deadline, because no work continues after
  the response (plan §4). The form shows a pending state during that time.
- **Retries use the same codes.** The admin retry endpoint (`POST /api/complaints/[id]/retry-ai`)
  and its button map each failure to `AI_DISABLED`, `AI_IN_PROGRESS`, `AI_RETRY_LIMIT` or
  `INVALID_TRANSITION`.

## Amendment (2026-11-04): one retry for a brief provider outage

MIR-1017 went to review because a single Gemini call failed with `PROVIDER_UNAVAILABLE` after 755 ms, before the model
saw the report. A one-off like this should not cost a manual routing, so the agent loop (`run-agent.ts`) now retries
exactly once, after `PROVIDER_RETRY_DELAY_MS` (750 ms), and only:

- for `PROVIDER_UNAVAILABLE` (a 5xx such as "model overloaded", or the network);
- while the attempt's deadline (`AI_TIMEOUT_MS`) has not fired. If it fires during the pause, the result is `TIMEOUT`.

Rate limits (`RATE_LIMITED`) and refusals (`PROVIDER_REJECTED`) are never retried. Re-running a whole attempt that
went to review stays an administrator's decision (P4.08). The Gemini adapter now extends the conversation only after
a call succeeds, so a retry repeats the identical request. `agent.run_finished` logs `providerRetried`.

## Amendment 2 (2026-11-04): keyword fallback when the AI cannot route

Goal: a clear report reaches its department even when the AI attempt cannot route it, without weakening the safety
guarantee. After an attempt ends in review, `triage.ts` asks `classifyByKeywords` (`keyword-router.ts`) only when:

- the reason says nothing about the report itself: `TIMEOUT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
  `PROVIDER_REJECTED`, `INVALID_OUTPUT`, `STEP_LIMIT` or `MODEL_REQUESTED_REVIEW`;
- the safety screen found nothing (`SAFETY_REVIEW` and `HIGH_PRIORITY_REVIEW` always stay with a person, as does any
  report with a safety signal);
- one category clearly leads (it matches more keyword groups than any other; "other" never routes by keywords), and
  that category has an enabled default department.

The route is an ordinary decision (priority `medium`) that goes through `agent_finish_run`, so the database applies
the same policy as to an AI route. The ticket's history note reads "Routed by keyword rules because the AI assistant
was unavailable" (or "could not decide"), the run's trace records `keyword_router accepted` with the original failure
code, and `agent.run_finished` logs `keywordFallback`. On the labelled evaluation set (120 reports) it routes 65, all
to the correct department, holds the 6 safety reports, and leaves 49 to a person; it was tuned on that set, so the
unit tests also check wordings it was not tuned on.
