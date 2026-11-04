# Evidence: Add-on phase A1, cloud jobs and image foundation

**Gate A1 (plan v2 §14):** persistence and the queue work under a provider outage; no ticket is
lost.

Design decisions: [ADR 0009](../adr/0009-evidence-storage-and-ai-job-queue.md).

## Task checklist

| ID    | Task                                                                     | Status | Evidence                                                                                                     |
| ----- | ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------ |
| A1.01 | Private bucket; upload/finalize route with ownership checks              | Done   | Bucket + Storage policies; `POST /api/complaints/[id]/photos` and `/photos/finalize`                         |
| A1.02 | Durable queue, `ai_jobs`, transactional enqueue, restricted consumer     | Done   | pgmq `makeitright_ai_jobs`; `enqueue_ai_job` in the finalize transaction; service-role-only worker functions |
| A1.03 | Cron invokes the authenticated Edge worker; retries and safe ack/archive | Done   | `makeitright-ai-worker`; `cron.schedule` every minute via Vault secrets; drills below                        |
| A1.04 | Structured job states; admin panel for failures and retry                | Done   | `/admin/jobs` with filters, failure reasons, `admin_retry_ai_job` (max 3)                                    |

Also in this phase: F1.01 (bucket, MIME allowlist, 2 MiB cap, per-user policies) and F1.02
(signed direct upload, finalization that rejects wrong signatures, oversized payloads and
orphaned references), on which the queue's first job type depends.

## Verify clauses, as tested

| Plan clause                                                        | How it was shown                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No public image links or unbounded payloads (A1.01)                | Integration: public URL fails; other student, anon and unfinalised-admin downloads fail; a 2 MiB + 1 B upload is refused; no overwrite                                                                                                                                                     |
| Student A cannot access Student B photos (F1.01)                   | Integration (Storage download and folder list) and pgTAP (`can_read_evidence`)                                                                                                                                                                                                             |
| Text complaint still submits if image upload fails (F1.02)         | E2E: a fake `.png` is rejected (`EVIDENCE_REJECTED`), the report is untouched, and no job is created                                                                                                                                                                                       |
| Submitting does not wait for AI (A1.02)                            | Integration: the job is `queued`, attempts 0, right after finalize; finalize returns immediately                                                                                                                                                                                           |
| Worker recovers after a forced error; no duplicate effects (A1.03) | Integration against the real Edge Function: the `crash` drill leaves the job `running`; after the 1 s visibility timeout, attempt 2 succeeds; a further run leaves it untouched. pgTAP: a late attempt-1 report is refused (MR412); a redelivered finished job is archived without running |
| Simulated 429 goes to review after the limit (A1.04)               | Integration: the `rate_limited` drill gives attempts 1–2 `retry_wait`, then 3 `needs_review` (`RATE_LIMITED`). pgTAP: the same with explicit claims                                                                                                                                        |

Two mutation checks, run then reverted:

- Making the bucket public, or `can_read_evidence` always true, fails the privacy integration test.
- The A0 mutation checks still apply to `008`.

## Screenshots (local preview, `FEATURE_VISUAL_INSPECTION=true`, AI off)

| View                                   | File                                                      |
| -------------------------------------- | --------------------------------------------------------- |
| Reporter's ticket after adding a photo | [student-photo-desktop.jpg](a1/student-photo-desktop.jpg) |
| The same on a phone (375 px)           | [student-photo-mobile.jpg](a1/student-photo-mobile.jpg)   |
| Admin → AI jobs after Retry            | [admin-ai-jobs.jpg](a1/admin-ai-jobs.jpg)                 |

The photo is a synthetic drawing (`tests/fixtures/evidence/synthetic-sink.png`), not a real
place. The thumbnail is served from `127.0.0.1:54321/storage/v1/object/sign/complaint-evidence/...`
with a token, and the browser console had no errors.

## Local verification

Run on 2026-11-05 on `phase/a1-jobs-storage` after `supabase db reset` (fresh local stack with
Storage and the Edge runtime). The first E2E server has every flag OFF; the second has
`FEATURE_VISUAL_INSPECTION=true`.

| Suite                        | Result                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| `pnpm lint`                  | Pass, 0 warnings                                                           |
| `pnpm typecheck` (tsc)       | Pass (includes the Edge Function and its shared modules)                   |
| `pnpm format:check`          | Pass                                                                       |
| `pnpm test` (unit + DOM)     | **479 / 479** (34 new: worker logic, retry policy, settings, image checks) |
| `pnpm db:test` (pgTAP)       | **385 / 385** in 9 files (71 new in `009_ai_jobs_and_evidence`)            |
| `pnpm test:integration`      | **113 / 113** (9 new: real Storage and the real Edge Function)             |
| `pnpm build`                 | Pass                                                                       |
| `pnpm test:e2e` (Playwright) | **201 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed |

New E2E journeys (`evidence.spec.ts`), each on desktop Chromium and Pixel 7:

- add a photo to a saved report (signed URL, image renders, one job queued, axe clean);
- a fake image is refused and the report stays intact;
- an admin sees the failed job with its reason and retries it (axe clean);
- with every flag OFF, nothing of the add-on is visible or reachable: no Photos section, the photo
  API returns 404, there is no "AI jobs" link, and `/admin/jobs` shows the 404 page.

All existing journeys still pass, including AI routing through the Gemini stub (primary model,
backup model, keyword fallback), auth, workflow and admin.

## Not yet verified

- **Cloud deployment.** The A1 migration is not pushed, and the Edge Function, its secret and the
  Vault secrets are not deployed. Plan A7.03 schedules the worker deployment, and every push
  needs the owner's approval. With every flag OFF, production behaves as before.
- **Photo analysis itself** is A2. Until then every photo job goes to review with
  `HANDLER_UNAVAILABLE`, by design.
- **Orphaned objects.** A reservation the browser never finishes leaves a private object with no
  finalized row. It is unreadable to others and expires as an upload slot after 30 minutes, but
  nothing deletes it yet.
