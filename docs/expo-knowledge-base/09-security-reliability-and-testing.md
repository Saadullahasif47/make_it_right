# 09. Security, reliability and testing

## 1. Authentication vs authorization

- **Authentication** answers "who are you?" Supabase Auth checks email and password and issues a
  session in `HttpOnly; SameSite=Lax` cookies. Passwords are at least 10 characters; Supabase stores
  them hashed.
- **Authorization** answers "what may you do?" Enforced twice: by the server
  (`requirePageAccess(roles, path)` on every page, role read from `profiles` per request) and by the
  database (RLS, column grants, function checks).

## 2. Protections that exist (with evidence)

| Protection                    | How it works                                                                                                                                                                                                        | Evidence                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Role-based access             | Three roles; sign-up always student; only `display_name` is user-editable (column grant)                                                                                                                            | pgTAP `002_identity_access`; [ADR 0002](../adr/0002-identity-access-and-environments.md)         |
| Row-level security            | All 27 tables; default grants revoked; private helper schema                                                                                                                                                        | pgTAP `001_schema_guarantees` (fails if anything new is open)                                    |
| Function allow-list           | Exactly 32 functions executable by signed-in users; AI write paths only for the service role                                                                                                                        | pgTAP `001`                                                                                      |
| Secure photo storage          | Private bucket; type and size limits; Storage policies tied to rows; no replace; magic-byte and SHA-256 checks; 5-minute signed URLs; not cached by the image optimiser                                             | [ADR 0009](../adr/0009-evidence-storage-and-ai-job-queue.md); E2E with a fake image              |
| Server-side validation        | Zod `strictObject` on every input; SQL check constraints repeat the limits; a unit test detects drift                                                                                                               | `src/features/*/schemas.ts`                                                                      |
| Cross-site request protection | APIs accept JSON only (415 otherwise) and refuse requests whose `Origin`/`Sec-Fetch-Site` shows another site; 16 KB body cap                                                                                        | smoke test "a cross-site submission is refused"                                                  |
| No enumeration                | Invisible = 404, never 403; identical sign-in and reset messages                                                                                                                                                    | [ADR 0003](../adr/0003-complaint-persistence.md)                                                 |
| Open-redirect protection      | `toSafeInternalPath` rejects off-site, protocol-relative and control-character paths                                                                                                                                | unit tests                                                                                       |
| Access-controlled AI tools    | Tool allow-list, Zod arguments, scope checks, no write tools; privileged key confined to `src/features/agent` by lint                                                                                               | [ADR 0005](../adr/0005-bounded-ai-triage.md), [ADR 0012](../adr/0012-maintenance-coordinator.md) |
| Prompt-injection containment  | Sanitise and fence input; "data, not instructions"; no write tools; code and SQL re-check every decision                                                                                                            | injection cases in evaluations                                                                   |
| AI output validation          | JSON schema + Zod; invalid → `INVALID_OUTPUT`, nothing stored                                                                                                                                                       | unit tests                                                                                       |
| Human approval                | Review queue, duplicate decisions, coordinator approvals, closing by reporter                                                                                                                                       | E2E specs                                                                                        |
| Rate limits (in SQL)          | 20 reports / 10 min / student; 3 AI attempts per ticket; 10 admin retries / 10 min; 5 coordinator runs / case / day; 3 admin job retries per job; 10 responses / person / analysis; 12 repair photos / case         | pgTAP, integration                                                                               |
| Input sanitisation for AI     | Emails, phone numbers, ids and links replaced before any model call; a copy in the worker kept identical by a unit test                                                                                             | `sanitize.ts`, `_shared/text/`                                                                   |
| Security headers              | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera, mic, location, payment off)                                                                            | `next.config.ts`; smoke test                                                                     |
| Secrets management            | Read only in `src/lib/config`; Sensitive Vercel variables; Edge Function secrets; Vault for the worker URL/secret; nothing committed; the test stub URL and local worker secret are refused outside the local stack | [cloud runbook](../runbooks/cloud-environments.md)                                               |
| Worker authentication         | Shared secret ≥ 32 characters, constant-time comparison; failure drills disabled outside local                                                                                                                      | [ADR 0009](../adr/0009-evidence-storage-and-ai-job-queue.md)                                     |
| Logging privacy               | Logger redacts credentials, identities and complaint text; never logs stack traces; request ids validated                                                                                                           | [ADR 0001](../adr/0001-stack-and-repository-structure.md)                                        |
| Database integrity            | Foreign keys, checks, partial unique indexes, append-only triggers, versioning                                                                                                                                      | [document 6](06-database-design.md)                                                              |

**Not in place:** a nonce-based Content Security Policy (deferred); general IP-based rate limiting
on the HTTP layer (only the per-user SQL limits above and Supabase Auth's own limits, which were not
separately verified); email verification is relied on, but there is no CAPTCHA; no external
security audit or penetration test.

## 3. Reliability

| Mechanism             | What it guarantees                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Saved first           | A report is committed before any AI runs; AI failure never loses it                                  |
| Idempotency           | A repeated submission returns the same ticket; a changed one with the same key is refused            |
| Optimistic versioning | Concurrent edits: one wins, the other gets 409                                                       |
| Durable queue         | Job row and message in one transaction; nothing queued is lost if the request ends                   |
| Retries               | Rate limits, outages, timeouts retry with backoff and jitter (≈30/60/120 s), 3 attempts, then review |
| Attempt token         | A late result from a timed-out worker cannot overwrite a newer attempt (`MR412`)                     |
| Crash recovery        | A claimed message reappears after its visibility timeout; the next claim counts the attempt          |
| Superseding           | AI results for a case or ticket that changed meanwhile are recorded but not applied                  |
| Kill switches         | `AI_ENABLED=false` (app and worker), each `FEATURE_*` switch, Vault secrets for the worker           |
| Rollback              | Vercel Instant Rollback; forward-only migrations; never drop tables in an emergency                  |

## 4. Testing strategy

Results from the most recent full run, on branch `fix/expo-presentation` (2026-11-08, before
merging PR #31), on the local stack:

| Layer              | Tool                                   | Count                                         | What it proves                                                                                                                                      | What it cannot prove                  |
| ------------------ | -------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Unit and component | Vitest, Testing Library                | **584** passed (35 files)                     | Pure logic: policies, schemas, sanitiser, ranking, prompts, adapters with injected `fetch`, UI components                                           | Real database or real model behaviour |
| Database           | pgTAP                                  | **573** in 14 files (A7 gate run)             | RLS, grants, the function allow-list, constraints, transitions, triggers, rules                                                                     | UI or network behaviour               |
| Integration        | Vitest against local Supabase          | **151** passed (12 files)                     | Auth and Data API, real SQL functions, Storage, the real Edge worker with a Gemini stub, races                                                      | Cloud configuration                   |
| End to end         | Playwright, desktop Chrome and Pixel 7 | **233** passed, 7 skipped by design, 0 failed | Full journeys in a production build: submit, route, work, resolve, confirm, photos, duplicates, coordinator, repair verification, heatmap, insights | Real Gemini (uses a stub), real cloud |
| Accessibility      | axe-core in Playwright                 | Inside the E2E run                            | WCAG 2.1 AA rules on key pages, both themes, desktop and mobile                                                                                     | Full manual accessibility audit       |
| Mobile             | Playwright Pixel 7 project             | Every E2E spec on both projects               | Layouts and flows on a phone viewport                                                                                                               | Real devices, slow networks           |
| Security probes    | pgTAP, integration, E2E                | Within the counts above                       | Signed-in users cannot call AI write paths; forged claims fail; no enumeration                                                                      | Attacks outside these scenarios       |
| AI evaluations     | Vitest `eval` project, live Gemini     | Six datasets                                  | Quality on labelled synthetic data                                                                                                                  | Real-world accuracy                   |
| Failure injection  | `pnpm drills`, worker drill headers    | 22/22 checks (P6); A7 crash drill             | No report lost, no false success; crash redelivery without duplicates                                                                               | Every failure mode                    |
| Load               | `pnpm load:test`, `pnpm load:queue`    | 1/5/20 concurrency                            | 0 errors; p95 147/103/227 ms submit (local); queue 100% analysed with recovery                                                                      | Thousands of users; cloud limits      |
| Release smoke      | `pnpm smoke`                           | 27/27 on production `4879ce9`                 | Deployed commit, headers, redirects, anonymous refusals, cross-site refusal                                                                         | Signed-in journeys                    |

Mutation checks were used during development: removing `FOR UPDATE` made the concurrency test fail
(lost update); ignoring the idempotency key made the E2E replay test fail with four tickets;
granting an AI write function to signed-in users made the allow-list test fail.

### Measured performance (from evidence)

| What                               | Result                                                                    | Source                                                         |
| ---------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Signed-in submissions, local       | p95 147 / 103 / 227 ms at 1 / 5 / 20 concurrent; 0 errors                 | [p6-load-local](../evidence/p6-load-local.md)                  |
| Live production, public endpoints  | p95 389–933 ms at up to 20 concurrent from Pakistan; 0 errors             | [p6-cloud-latency](../evidence/p6-cloud-latency-production.md) |
| Photo pipeline, local (stub model) | Queue p50/p95 4.5/5.9 s (1), 3.2/3.7 s (5), 4.7/5.8 s (20); 100% analysed | [a7-release](../evidence/a7-release.md)                        |
| Crash drill                        | Crashed job redelivered, succeeded on attempt 2, 0 duplicates             | [a7-release](../evidence/a7-release.md)                        |

### Run during this documentation task (2026-11-08)

Only documentation checks were run; no application code or test changed.

- Prettier `format:check` on the whole repository: passed.
- Local link check over this folder: 140 relative links and anchors, 0 broken.
- Mermaid: all 12 diagrams parsed and rendered with Mermaid 10.9.1. One sequence diagram was fixed
  (a semicolon in a message ends the line in Mermaid's syntax), and the database diagram was split into
  four so each part is readable on an A4 page.
- `pnpm smoke` against production earlier the same day: 27/27 on `4879ce9`.

The test counts in the table above come from runs earlier in the same session, not from this
task.

## 5. CI/CD

Every pull request runs the full pipeline in GitHub Actions (about 6–8 minutes): lint, typecheck,
format, unit, dependency audit, local Supabase, type drift check, pgTAP, integration, build, and
Playwright on two devices. Merges happen through PRs only (free private repositories have no branch
protection; the rule is followed by process). Vercel deploys a preview for each push and production
from `main`.
