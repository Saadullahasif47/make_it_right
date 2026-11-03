# Evidence: Phase 6, QA and resilience

**Gate P6:** regression suite green; failure tests pass; metric report and screenshots checked in.

Every number below was measured by a script in this repository on 2026-11-03. Nothing is
estimated. The scripts can be re-run at any time:

| Script                                            | What it measures                                     |
| ------------------------------------------------- | ---------------------------------------------------- |
| `pnpm load:test --base-url http://localhost:3100` | 1, 5 and 20 concurrent signed-in submissions (P6.02) |
| `pnpm drills`                                     | Five injected failures, 22 checks (P6.03 to P6.05)   |
| `pnpm latency:cloud`                              | Read-only latency of the live production deployment  |

## Task checklist (plan §15)

| ID    | Task                                                         | Status | Evidence                                                    |
| ----- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------- |
| P6.01 | All unit, SQL and Playwright tests with clean test accounts  | Done   | [Regression suite](#regression-suite) after `db reset`      |
| P6.02 | 1, 5 and 20 concurrent submits: p50/p95, errors, idempotency | Done   | [p6-load-local.md](p6-load-local.md), [cloud](#live-cloud)  |
| P6.03 | Gemini key removed: ticket waits for review, no data loss    | Done   | [p6-drills.md](p6-drills.md) drills 1 and 2                 |
| P6.04 | Failed database write: the client never sees false success   | Done   | Drill 3 and the screenshot below                            |
| P6.05 | Stale version and duplicate submit: exact audit behaviour    | Done   | Drills 4 and 5; idempotency wave of the load test           |
| P6.06 | Source review: secrets, role bypasses, SQL, unsafe logs      | Done   | [Security review](#security-review-p606)                    |
| P6.07 | Dependency scan; address high and critical findings          | Done   | [Dependency audit](#dependency-audit-p607): none high/crit. |
| P6.08 | Short assessment report from measured results                | Done   | This document                                               |

## Regression suite

Run from a clean database (`supabase db reset`, which re-creates the fictional seed accounts):

| Suite                               | Local result                                    | CI       |
| ----------------------------------- | ----------------------------------------------- | -------- |
| lint / typecheck / format / build   | Pass                                            | CI_CHECK |
| Unit + component (Vitest)           | **382 / 382**                                   | CI_CHECK |
| pgTAP (`pnpm db:test`)              | **222 / 222**                                   | CI_CHECK |
| API integration (Auth + REST)       | **80 / 80**                                     | CI_CHECK |
| E2E (Playwright, desktop + Pixel 7) | **147 passed**, 1 skipped by design, 4 see note | CI_E2E   |

Local E2E note: the first run had 9 failures. Five were the browser running out of memory on
this low-memory laptop (`Target crashed`, `ERR_INSUFFICIENT_RESOURCES`) and passed on a single-worker
re-run. The other four are the sign-up and password-reset email tests. Locally, Playwright
reused a server left on port 3100 by the load test, which builds email links for port 3000, so
those links pointed at another program. This is a test-environment problem, not an application
fault. CI starts from a clean machine and never reuses a server, so the CI column is the verdict
for those four tests.

## Load: concurrent submissions (P6.02)

Local production build (`next start`) against local Supabase. Each request is a real signed-in
student's `POST /api/complaints` with a browser-identical session cookie. Run `054308af`:

| Concurrent | Requests | Succeeded | Errors | p50    | p95    | Throughput |
| ---------- | -------- | --------- | ------ | ------ | ------ | ---------- |
| 1          | 20       | 20        | 0      | 51 ms  | 147 ms | 14.4 req/s |
| 5          | 20       | 20        | 0      | 71 ms  | 103 ms | 57.2 req/s |
| 20         | 20       | 20        | 0      | 217 ms | 227 ms | 86.6 req/s |

- **Idempotency:** 20 keys were each sent twice at the same instant. All 20 pairs returned one
  ticket, and exactly one request of each pair reported `created: true`.
- **Ground truth:** the database held 81 tickets and 81 `created` audit events, exactly the
  number of distinct submissions.
- An earlier run the same day (`4ad53cb8`) gave the same picture: 0 errors, 20 / 20 pairs, p95
  165 / 119 / 293 ms.

### Live cloud

The production deployment (`bce1355`, Vercel + Supabase) was probed from the developer's
machine in Pakistan, so each figure includes the international round trip. The probe is
read-only: no accounts are created and nothing is written. Full table:
[p6-cloud-latency-production.md](p6-cloud-latency-production.md).

| Endpoint, 20 concurrent           | Requests | Errors | p50    | p95    |
| --------------------------------- | -------- | ------ | ------ | ------ |
| `GET /api/health` (function)      | 20       | 0      | 504 ms | 538 ms |
| `GET /login` (server-rendered)    | 20       | 0      | 589 ms | 933 ms |
| `POST /api/complaints` signed out | 20       | 0      | 512 ms | 868 ms |

The signed-out submission returns 401 every time, which shows the function ran its session check
under load. A signed-in load test against the cloud was not run: the cloud database is shared by
previews and production until P7 (ADR 0002), and the test would add temporary accounts to it.
The script supports it (`--allow-cloud`) once the owner approves.

## Failure drills (P6.03 to P6.05)

All five drills passed, **22 / 22 checks**. Details: [p6-drills.md](p6-drills.md).

1. **AI switched on with no Gemini key.** The report is accepted (201), stored, and waits for
   review with failure code `PROVIDER_NOT_CONFIGURED`. The audit trail reads created, triage
   started, review requested.
2. **Gemini unreachable.** Same result with `PROVIDER_UNAVAILABLE`.
3. **The database write fails.** A trigger injected on insert makes the write fail. The API
   answers 503 `SERVICE_UNAVAILABLE`, no ticket is stored, and no idempotency key is used up.
   The form shows the error and keeps the student's text. With the fault removed, the same
   submission and key succeed (201).
4. **Ten simultaneous duplicates with one key.** All ten point to one ticket. One response says
   created and nine are replays. One ticket and one `created` event are stored.
5. **Two staff start work on one ticket at the same moment.** One gets 200 and the other gets
   409 `STALE_VERSION`. The ticket moves forward once, with one audit event.

The plan asks for drill 1 "in preview". It ran on a local production build with the key
removed from the environment instead, because previews and production share one set of Vercel
variables and one database. The code path is the same.

What the student sees when storage fails (drill 3):

![Database failure drill](p6-drill-database-failure.png)

## Security review (P6.06)

| Check                                 | Result                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Secrets in the repository and history | None. `git log -p` over all history has no key material. Only `.env.example` is tracked.                                 |
| Public environment variables          | Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.                                              |
| Secret key usage                      | `src/lib/supabase/privileged.ts` is imported only by the agent (`features/agent/instance.ts`, `store.ts`), per ADR 0005. |
| Client and server boundary            | No client component imports a server-only module.                                                                        |
| Role bypasses                         | All 13 `SECURITY DEFINER` functions check the caller's role and pin `search_path = ''`.                                  |
| SQL in application code               | None. All data access goes through the typed Supabase client and database functions.                                     |
| Logs                                  | No complaint title or description is logged. Request logs carry route, status, duration and request id only.             |

## Dependency audit (P6.07)

| Scope                      | Result                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm audit --prod`        | **No known vulnerabilities.**                                                                       |
| `pnpm audit` (development) | **1 moderate**, 0 high, 0 critical: `minimatch` below 11.0.1 (pattern-expansion denial of service). |

The moderate finding is accepted. `minimatch` comes only through lint tooling
(`eslint > @eslint/config-array` pins `^3.1.5`, `@typescript-eslint/typescript-estree` pins
`^10.2.2`). It is not shipped to users, and it only ever expands glob patterns written in this
repository's own lint configuration, never user input. Forcing version 11 would break
`@eslint/config-array`, which uses the version 3 API. The plan requires fixing high and critical
findings only. Re-check when ESLint publishes an update.

## Assessment

- **Correctness under concurrency holds.** The load run sent 101 submissions (81 distinct, 20
  deliberate duplicates) with no errors, no duplicate tickets and no missing audit events. Concurrent staff updates are
  serialised by the version check.
- **Failures are honest.** No drill produced a false success. When the AI is unavailable, the
  ticket is kept and sent to human review. When storage fails, the student is told and keeps
  their text.
- **Cloud latency is dominated by distance.** The live deployment answered every probe, with
  p95 under one second at 20 concurrent requests from Pakistan.
- **Not covered:** a signed-in cloud load test (needs the owner's approval, above) and photo
  upload, which is deferred (ADR 0006).
