# ADR 0009: Private evidence storage and the durable AI job queue

- **Status:** Accepted
- **Date:** 2026-11-05
- **Phase:** A1 (Advanced Features add-on)

## Context

Plan v2 §05 and phase A1 ask for:

- private photo storage with an upload and finalize flow and ownership checks (A1.01, F1.01–F1.02);
- a durable queue where the job record and its message are saved in one transaction, consumed by
  one authenticated Edge Function on Supabase Cron, with bounded retries and safe redelivery
  (A1.02–A1.03);
- an admin view of failed jobs with a retry (A1.04).

**Gate A1:** persistence and the queue survive a provider outage, and no ticket is lost.

## Decisions

### Photos: reserve, upload directly, check, finalize

1. **The attachment row exists before any byte is uploaded.**
   - `request_evidence_upload` (as the signed-in reporter) creates a `pending` row at
     `<uploader id>/<attachment id>.<ext>`.
   - The server then asks Storage for a signed upload URL with the user's own token, and the
     browser PUTs the file straight to the private bucket. Photo bytes never pass through Vercel.
2. **Storage policies tie every object to its row.** Policies on `storage.objects` call three
   `private` helpers that run as the caller, so `evidence_attachments` RLS still applies:
   - **insert:** only into a `pending` row of the caller's, within 30 minutes of reserving it;
   - **select:** finalized photos the caller can see, plus the uploader's own pending file;
   - **delete:** the uploader's own unfinalized objects.

   There is no update policy, so a stored photo can never be replaced. The bucket itself is
   private, 2 MiB and JPEG/PNG/WebP only. One unit test reads the migrations so the bucket, SQL
   and form limits cannot drift apart.

3. **The server checks the bytes before finalizing.** `finalizeUpload` downloads the object with
   the user's token and checks:
   - the size;
   - the real file signature (magic bytes), whatever type the browser declared;
   - the SHA-256.

   If the photo fails, it is discarded and its object removed (`EVIDENCE_REJECTED`, HTTP 422).
   `finalize_evidence_upload` then re-checks the object's stored size and type, marks the photo
   finalized, and enqueues `visual_analysis`, all in one transaction. Finalizing again returns the
   same job. A missing object, meaning an orphaned reference, is `MR404`.

4. **The report never depends on the photo.** Photos are added on the saved report's page, after
   the submission. A failed upload shows a message and leaves the report untouched; the E2E suite
   proves this with a fake image.
5. **Photos are shown through five-minute signed URLs** with `next/image` `unoptimized`. A private
   photo therefore never enters the shared `/_next/image` optimizer cache.
6. **Only the reporter adds photos in A1.** Staff after-photos belong to cases and arrive with
   F4 (A5). Staff and admins can already read finalized photos (Storage policy and RLS).

### The queue

7. **One pgmq queue, `makeitright_ai_jobs`; messages carry only `{"job_id"}`.**
   `private.enqueue_ai_job` inserts the `ai_jobs` row and sends the message in the caller's
   transaction. A repeated `dedupe_key` returns the existing job and sends nothing.
8. **Three service-role functions are the worker's only access:**
   - `worker_claim_ai_jobs` reads messages with a visibility timeout and marks each job
     `running`, `attempts + 1`;
   - `worker_complete_ai_job` and `worker_fail_ai_job` report results.

   Signed-in users, admins included, cannot execute them (pgTAP and integration tests).

9. **The attempt number is the delivery token.** A message that reappears after its visibility
   timeout keeps its `msg_id`, so a report must also match the job's current `attempts`. A late
   report from a worker that timed out is refused with `MR412` and dropped; it can never overwrite
   a newer attempt.
10. **Bounded retries with backoff and jitter.**
    - A retryable failure waits (`retry_wait`) by pushing the message's visibility forward: about
      30 s, 60 s, then 120 s (capped at 300 s), plus up to 10 s of jitter.
    - After three attempts, or on a non-retryable failure, the job goes to `needs_review` and its
      message is archived.
    - If a worker dies mid-job, its message reappears and the next claim counts the attempt. A
      third silent death ends as `WORKER_TIMEOUT`.
    - A redelivered message for a finished job, or a malformed one, is archived without running.
11. **The worker claims one job at a time**, and only while a whole job still fits in its 110 s
    budget, which is under the 150 s Edge Function limit. Each handler has a 45 s limit, and a
    claimed message stays hidden for 90 s. A running job is therefore never handed to a second
    worker, and a handler that ignores its abort signal is still cut off.
12. **Supabase Cron runs `private.invoke_ai_worker()` every minute.**
    - It calls the worker through `pg_net` only while work is pending (queued, running, or a retry
      due within a minute), so idle minutes cost no function invocations.
    - The worker URL and secret are per-environment Vault secrets (`makeitright_ai_worker_url`,
      `makeitright_ai_worker_secret`). Without them nothing is sent, so a fresh environment is
      safe until it is configured.

### The Edge Function

13. **`makeitright-ai-worker` is a thin Deno entry point.**
    - All logic lives in `supabase/functions/_shared/jobs/` as plain TypeScript: settings and
      auth, batch runner, retry policy, REST client and handler registry.
    - Vitest therefore tests it in Node, and `tsc` and ESLint check it with the rest of the repo.
    - It talks to PostgREST with `fetch` and validates every row with Zod (pinned through the
      function's `deno.json` to the app's version). No new package is added.
14. **Authentication is a shared secret in `x-worker-secret`** (`verify_jwt = false`), compared in
    constant time.
    - The secret must be at least 32 characters.
    - The committed local value (in `supabase/config.toml`, for Docker) is refused unless
      `SUPABASE_URL` is the local stack.
15. **Failure drills run on the local stack only.** With `AI_WORKER_FAULTS=true`, which is local
    config only, these headers simulate failures; elsewhere they are refused with
    `DRILLS_DISABLED`:
    - `x-worker-simulate: success | rate_limited | provider_unavailable | crash`
    - `x-worker-retry-delay`
    - `x-worker-visibility`

    The integration suite uses them to prove the 429-to-review path and crash recovery against
    the real function.

16. **Job types without a handler yet** (all six in A1) fail at once with `HANDLER_UNAVAILABLE`
    (non-retryable), so they wait for review instead of burning retries. A2–A6 each register
    their handler.

### Admin view

17. **`/admin/jobs` lists recent jobs** with status filters and plain-language failure reasons.
    - A job in review can be queued again with `admin_retry_ai_job`: admin only, at most three
      times per job, with a fresh attempt budget and a new message.
    - The page and its navigation item exist only while a feature that queues work is switched
      on, so with every flag OFF the app looks exactly as before.

### Existing routing is unchanged

18. **Ticket triage stays synchronous** (ADR 0005, with the backup model and keyword fallback).
    Plan F3 moves case coordination into the queue in A4. Nothing in A1 changes how a report is
    submitted or routed.

## Local stack

`pnpm db:start` now also runs `storage-api` and `edge-runtime`, which take more memory. Local
Storage's file limit is 2 MiB. `supabase/config.toml` sets the local worker secret and turns on
drills for Docker only.

## Rollback

1. Switch `FEATURE_VISUAL_INSPECTION` off: the photo section, API routes (404) and jobs page
   disappear.
2. Remove the two Vault secrets: Cron then sends nothing.
3. If needed, `select cron.unschedule('makeitright-ai-worker')`.

The schema is additive. Never drop the tables or the queue as an emergency step (plan §16).

## Consequences

- Deploying needs `supabase functions deploy makeitright-ai-worker`, the `AI_WORKER_SECRET`
  function secret, and the two Vault secrets. Plan A7.03 does this with the owner (runbook:
  cloud-environments.md).
- An abandoned reservation leaves a `pending` row, which expires after 30 minutes, and possibly
  a private orphan object. Neither is ever readable by anyone else. Sweeping such objects is left
  for a later phase; it is listed in the evidence.
