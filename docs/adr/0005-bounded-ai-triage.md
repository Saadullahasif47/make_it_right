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
10. **Honest labelling.** Agent events are shown as "AI assistant", and the prompt is versioned
    (`triage-v1`) on every run. With `AI_ENABLED=false` nothing is attempted, and tickets wait for
    manual routing exactly as in Phase 3. A deterministic fallback, if one is added later, must be
    labelled rule-based routing (plan §8).

### Testing without a live provider

11. **Three levels of stand-in.**
    - A provider-neutral `ModelClient` interface is implemented by the Gemini adapter and, in
      tests, by scripted models.
    - Unit tests drive the real adapter through an injected `fetch`, checking the exact REST
      request (tool-only mode, declarations, thought-signature echo) and one HTTP attempt on 429.
    - E2E runs a second production server against a local stateless Gemini stub
      (`GEMINI_BASE_URL`). The config refuses that variable on any deployment and accepts only
      loopback addresses.
12. **Live evaluation is opt-in.** `pnpm eval:agent` evaluates 120 labelled synthetic reports.
    The 30 held-out ones are the default, and the free-tier quota is respected. The report is
    written to `docs/evidence/p4-agent-eval-<split>.md`.

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
