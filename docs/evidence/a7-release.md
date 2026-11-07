# Evidence: Add-on phase A7, reliability, release and expo

**Gate A7 (plan v2 §14, §16):** the production readiness checklist is all YES, and the demo re-run
works after an environment reset.

Runbooks: [cloud environments](../runbooks/cloud-environments.md),
[release](../runbooks/release.md). Demo: [advanced 6-minute script](../demo-script-advanced.md).

## Task checklist

| ID    | Task                                                                    | Status                           | Evidence                                                                                             |
| ----- | ----------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A7.01 | Vitest, pgTAP/RLS, Playwright and CI; seeded no-AI fallback             | Done                             | A6 gate below (all green); the first E2E server runs every journey with AI and every add-on flag OFF |
| A7.02 | 1/5/20 concurrent submissions; queue and worker recovery; p50/p95       | Done (local)                     | `pnpm load:queue`, results below and in [a7/queue-load-local.json](a7/queue-load-local.json)         |
| A7.03 | Additive migrations, worker and secrets to the cloud; flags in sequence | Cloud done; flags with the owner | Rollout record below                                                                                 |
| A7.04 | Vercel production; quotas, project awake, signed photo access           | Waiting for the flags            | Production smoke 27/27 on `1f61ed6` with the new schema                                              |
| A7.05 | 6-minute demo; screenshots of cloud traces, job statuses, SQL metrics   | Script ready                     | [demo-script-advanced.md](../demo-script-advanced.md); drawn demo photos in `docs/demo/photos`       |

## Local verification (A7.01)

Run on 2026-11-07 on `phase/a7-release` after `supabase db reset`: lint, typecheck and format
pass; unit **584/584**; pgTAP **573/573** in 14 files; integration **151/151**; build passes;
Playwright **233 passed**, 7 skipped by design, 0 failed. The first E2E server runs everything with
AI and every add-on flag OFF (the no-AI fallback); the second runs with all six features on.

## Queue and worker load (A7.02, local stack)

Production build with photo analysis on (`makeitright-features`), the real HTTP API, the real Edge
worker, and the Gemini stub in place of Google. Each sample is one student's report plus one photo
(report, reserve, signed upload, finalise). Queue time runs from finalise to the stored analysis,
on the database clock. The worker was called back to back instead of once a minute.

| Concurrent students | Samples | Submitted | Submit p50 / p95 | Analysed     | Queue p50 / p95 | Max attempts |
| ------------------- | ------- | --------- | ---------------- | ------------ | --------------- | ------------ |
| 1                   | 10      | 10        | 181 / 273 ms     | 10/10 (100%) | 4.5 / 5.9 s     | 1            |
| 5                   | 10      | 10        | 268 / 299 ms     | 10/10 (100%) | 3.2 / 3.7 s     | 1            |
| 20                  | 20      | 20        | 734 / 778 ms     | 20/20 (100%) | 4.7 / 5.8 s     | 1            |

(Run `3d39093a` on 2026-11-07, rounded from the JSON.) Queue time includes waiting behind the
other jobs of the same level, because a level's waves are submitted before the worker drains them.

**Recovery drill:** 5 more photos were submitted. The first worker run crashed on purpose after
claiming one of them (`x-worker-simulate: crash`, 2-second visibility):

- the crashed job was redelivered and succeeded on attempt 2, and all 5 were analysed;
- 0 photos were analysed twice, and 0 were left without an analysis.

These are local numbers against a stub: they measure our pipeline (HTTP, database, Storage, queue,
worker), not Gemini's latency or quota. The v1 cloud latency and load evidence is in
[p6-cloud-latency-production.md](p6-cloud-latency-production.md) and
[p6-load-local.md](p6-load-local.md).

## Cloud rollout record (A7.03, owner-approved on 2026-11-07)

Project `makeitright-staging` (`ijmikxhkyrensmsnmvmb`), which serves Vercel preview and production.

| Step | What                                                                         | Result                                                                                                     |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0    | Snapshot before                                                              | 19 complaints, 76 cases (60 demo), 6 profiles                                                              |
| 1    | `supabase db push`: the 8 additive A1–A6 migrations (dry run reviewed first) | All applied                                                                                                |
| 2    | Re-applied the idempotent seed                                               | 19 complaints kept; 60 demo cases; 13 active work orders backfilled; 6 open alerts; 6 targets; 2 cron jobs |
| 3    | `supabase functions deploy makeitright-ai-worker`                            | Deployed (729 kB)                                                                                          |
| 4    | Worker secrets from a temporary file (deleted)                               | `AI_ENABLED`, `AI_WORKER_SECRET` (new, random), `GEMINI_API_KEY` (checked by hash), `GEMINI_MODEL`         |
| 5    | Vault: worker URL and secret                                                 | Both stored; Cron's runs succeed                                                                           |
| 6    | Health                                                                       | Unauthenticated call 401; production smoke 27/27 on `1f61ed6`                                              |

**Incident during step 4, fixed with the owner's approval.** `supabase secrets set` also uploaded
two local-only values from `config.toml` (`GEMINI_BASE_URL` and `AI_WORKER_FAULTS`). The worker's
own guard refused to start on the hosted project (503 `WORKER_NOT_CONFIGURED`), so no job ran
against the stub. Both were removed, and the trap is now documented in the cloud runbook.

## Release checklist (plan v2 §16)

| Item                                                                                        | Status | Evidence                                                                                                |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| All base tests still pass with all new flags disabled                                       | YES    | Every gate since A0: the first E2E server keeps every flag OFF and runs the full v1 suite               |
| All new tables have role-specific grants, RLS tests, foreign keys and indexes               | YES    | `001_schema_guarantees` (RLS on every table, the RPC allowlist) and pgTAP 008–014                       |
| Staff and students upload private images; anonymous and unrelated users cannot read them    | YES    | A1 and A5 integration and pgTAP: signed URLs only, no public bucket, other users denied                 |
| The queue is durable; 429s and timeouts retry safely and surface a review state             | YES    | A1 drills; the A7 recovery drill above                                                                  |
| Model, prompt and embedding versions recorded; JSON schema and dimensions validated         | YES    | `visual-v1`, `coordinator-v1`, `verify-v1`, `gemini-embedding-2` at 768 dimensions, on every stored row |
| Matching only creates candidates; admin review is required to link complaints               | YES    | A3 tests                                                                                                |
| One active case work order; the agent cannot close or mutate unauthorised rows              | YES    | A4 tests and the 25-scenario eval                                                                       |
| Human verification before closure; a dispute reopens with full audit                        | YES    | A5 tests                                                                                                |
| Heatmap and insight numbers match SQL queries; no inflation from duplicates                 | YES    | A6 tests and the mutation check                                                                         |
| Vercel preview and production work with the right secrets; no exposed API keys              | PARTLY | Production 27/27 with flags OFF on the new schema; flags not yet on (owner, Vercel dashboard)           |
| Quota and cost dashboards checked; signed-in demo accounts available; the demo can be reset | OWNER  | Reset = re-apply the seed; accounts = `scripts/seed-demo-accounts.mts` on the owner's machine           |
| Rollback tested: flags off, additive schema intact, previous app redeployed                 | YES    | Production runs exactly that configuration now: new schema, flags off, 27/27; never drop tables         |

## Remaining owner steps

1. **Vercel → Settings → Environment Variables**: add each switch with the value `true`, Preview
   first, in this order: `FEATURE_VISUAL_INSPECTION`, `FEATURE_DUPLICATE_DETECTION`,
   `FEATURE_MAINTENANCE_COORDINATOR`, `FEATURE_REPAIR_VERIFICATION`, `FEATURE_CAMPUS_HEATMAP`,
   `FEATURE_MAINTENANCE_INSIGHTS`. Then redeploy and run the advanced demo on the preview with the
   demo accounts.
2. Repeat step 1 for Production, redeploy, and run `pnpm smoke`.
3. Rehearse the advanced demo once more after `supabase db query --linked -f supabase/seed.sql`
   (the environment-reset re-run in the gate).

Rollback for any feature: set its `FEATURE_*` to `false` (or delete it) and redeploy. Its tables
and data stay.
