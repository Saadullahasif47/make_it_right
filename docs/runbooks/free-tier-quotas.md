# Runbook: free-tier quotas and warning thresholds

MakeItRight runs entirely on free tiers (plan §19). Free limits change, so the limits below are the
plan's figures (verified October 2026). **Always confirm the current numbers on each dashboard**
before a demo or a load test. If a provider ever asks to enable billing, stop and decide
deliberately: the target build needs no paid plan.

## Thresholds used here

| Level  | When                                   | Action                                                        |
| ------ | -------------------------------------- | ------------------------------------------------------------- |
| Watch  | Any quota reaches **70%** of its limit | Note it in the evidence log; check again before the next demo |
| Act    | Any quota reaches **90%**              | Pause load tests, previews and AI evaluations; clean up data  |
| Outage | A quota is exhausted                   | Follow the "If a limit is hit" section below                  |

## Checklist (run weekly, and the day before any demo)

| Service           | What to check                                                   | Where                                                 | Plan figure / note                                    | Measured 2026-11-03      |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------ |
| Supabase database | Database size                                                   | Dashboard → Project → Reports → Database              | 500 MB per project                                    | **12 MB** (2%)           |
| Supabase auth     | Monthly active users                                            | Dashboard → Authentication → Users / Usage            | 50,000 MAU                                            | 5 accounts               |
| Supabase storage  | File storage (only if photo evidence is enabled)                | Dashboard → Storage → Usage                           | 1 GB                                                  | not used                 |
| Supabase projects | Number of active free projects                                  | Organization → Projects                               | 2 active projects (ADR 0002 uses 1)                   | 1                        |
| Supabase pausing  | Project status before a demo                                    | Dashboard home (paused projects show a Resume button) | Pauses after about a week of low activity             | Active                   |
| Vercel            | Function invocations, function duration, data transfer          | Vercel → Project → Usage                              | Hobby allowances shown on the Usage page              | Check before load tests  |
| Vercel logs       | Errors and slow requests (`event:"http.request"`, `durationMs`) | Vercel → Project → Logs, filter by `http.request`     | Each API call logs route, status and duration (P5.03) | -                        |
| Gemini            | Requests per minute and per day for `gemini-3.1-flash-lite`     | Google AI Studio → Usage / Rate limits                | Limits are per Google Cloud project, not per key      | Check before evaluations |
| GitHub Actions    | Minutes used this month (private repository)                    | GitHub → Settings → Billing and plans → Usage         | Free minutes vary by plan and visibility              | about 6 min per CI run   |

Quick database check from the project folder (read-only):

```bash
pnpm exec supabase db query --linked "select pg_size_pretty(pg_database_size(current_database())) as db_size, (select count(*) from public.complaints) as complaints"
```

## What uses each quota

- **Vercel functions:** every page view and API call. The AI attempt runs inside the submit request
  (up to `AI_TIMEOUT_MS`, 10 s), so heavy submission bursts raise function duration.
- **Gemini:** one to three calls per new report (usually one with prompt `triage-v3`), plus admin
  retries (at most 3 per ticket, 10 per admin per 10 minutes, enforced in the database).
  `pnpm eval:agent` uses about 30 to 60 calls per run.
- **GitHub Actions:** one full run (lint, unit, database, integration, build, E2E) per push.

## If a limit is hit

| Limit reached                 | What users see                                                  | What to do                                                                                   |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Gemini rate limit (429)       | Reports are saved and wait in the review queue (`RATE_LIMITED`) | Nothing breaks. Route by hand, use **Retry AI routing** later, or set `AI_ENABLED=false`     |
| Gemini daily quota            | Same as above, for the rest of the day                          | Set `AI_ENABLED=false` on Vercel and redeploy until the quota resets (midnight Pacific time) |
| Supabase project paused       | Sign-in and pages fail                                          | Resume the project in the dashboard; allow a few minutes                                     |
| Supabase database near 500 MB | Writes may fail                                                 | Delete old synthetic test tickets; never store real student data                             |
| Vercel Hobby limits           | Deployments or functions throttled                              | Pause previews and load tests; wait for the monthly reset                                    |
| GitHub Actions minutes        | CI stops running                                                | Run the same checks locally (`pnpm check`, `pnpm db:test`, `pnpm test:integration`)          |

## Before load tests (Phase 6)

Load tests use short, controlled runs (1, 5 and 20 concurrent users), never continuous stress.
Before each run, check the Supabase, Vercel and Gemini usage above, and run with
`AI_ENABLED=false` unless the AI path itself is being measured.
