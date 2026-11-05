# ADR 0010: AI visual inspection of photo evidence

- **Status:** Accepted
- **Date:** 2026-11-05
- **Phase:** A2 (Advanced Features add-on, F1)

## Context

Plan v2 §06 (F1.03–F1.06) and phase A2 ask for a structured, explainable analysis of each
photo: what is visible, kept apart from guesses; what the photo cannot show; and when a person
must look. Uncertain images must be reviewable, the user or an admin can correct the result, and
the model's audit record stays untouched.

**Gate A2:** photos stay private; a valid photo produces structured observations; a contradictory
or unreadable image asks for review; and the ticket workflow survives an AI outage.

## Decisions

### The analysis runs in the queue's worker

1. **`visual_analysis` jobs run in the A1 worker** (`makeitright-ai-worker`), not in a request.
   Adding a photo never waits for the model.
2. **The handler re-checks the photo before analysing it.**
   - It loads the photo's report through the service-role `worker_visual_context`, and only for a
     finalized photo.
   - It downloads the private object with the service key.
   - Size, file signature and SHA-256 must all equal what finalize recorded. A mismatch is
     `PHOTO_INTEGRITY` (not retryable), so a swapped object is never analysed.
3. **One multimodal `generateContent` call with structured output.**
   - The image goes inline (base64); `responseMimeType: application/json` and
     `responseJsonSchema` describe the contract; thinking is `MINIMAL`, as measured for triage in
     ADR 0005.
   - The key goes in the `x-goog-api-key` header, never the URL.
   - It uses plain `fetch` (no SDK in the Edge runtime), with the same timeout and error
     vocabulary as triage:
     - `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` and `TIMEOUT` retry through the queue (3 attempts);
     - `PROVIDER_REJECTED` and `INVALID_OUTPUT` go straight to review.
4. **The worker has its own kill switch.** Without `AI_ENABLED=true` in its secrets the job ends
   as `AI_DISABLED`; with no key, as `PROVIDER_NOT_CONFIGURED`. Both are non-retryable and visible
   to admins. `GEMINI_BASE_URL` (the test stub) is refused anywhere but the local stack.

### The contract and the review policy

5. **The model answers one schema.**
   - Fields: `visible_observations`, `possible_issue`, `suggested_category` (the six routing
     categories plus `unclear`), `severity_hint`, `not_visible_or_uncertain`, `image_quality`
     (usable / blurry / dark / unrelated), `text_consistency`, `needs_human_review` and
     `explanation`.
   - Zod validates it strictly; any deviation is `INVALID_OUTPUT` and nothing is stored.
6. **Prompt `visual-v1` asks for visible evidence and uncertainty only.**
   - It uses the same category definitions as triage, so a photo's suggestion and the routing
     agree on what each category means.
   - Text in the photo or report is data, never instructions.
   - The report reaches the model through the triage sanitiser (identifiers redacted, fenced).
     The Edge worker cannot import the app, so it uses a copy, and a unit test fails if the two
     ever differ.
7. **People are brought in by deterministic code, not by the model.** `toStoredAnalysis` sends
   the analysis to a person whenever any of these is true:
   - the photo is blurry, dark or unrelated;
   - it contradicts the report (both stay recorded);
   - the category is unclear;
   - the severity is high;
   - the model asks for review;
   - the wording claims more certainty than a photo allows ("definitely", "confirmed", "is
     safe"…).

   Each reason is kept as an uncertainty flag. The table re-checks the core rule
   (`visual_analyses_review_when_unsure`), so a policy bug cannot store an unsure analysis as
   settled.

### Storage and audit

8. **`visual_analyses` is the model's immutable audit record.** It holds:
   - the model, the prompt version, the job, and what the model said;
   - one row per (photo, prompt version). `worker_save_visual_analysis` requires the job's
     current attempt (MR412 otherwise) and keeps the first result if a retry saves again.

   Updates are rejected for everyone, the table owner included. Reading follows ticket
   visibility: the reporter, the assigned department and admins.

9. **People respond in `visual_analysis_reviews`, which is append-only.**
   - The reporter can confirm or dispute (a dispute needs a note); an admin can also record a
     corrected category. Department staff read but do not respond for the reporter.
   - A response never changes the analysis, the ticket's category or its routing. Routing stays
     with the triage agent and people (ADR 0005).
   - Each person may respond at most ten times per analysis.
10. **`photo_analysis_states` exposes only the job state a reporter needs** (analysing / done /
    with staff), scoped like ticket visibility. Job records themselves stay admin-only.

### Interface

11. **Every viewer of the ticket gets a Photos section** (reporter, department and admin) while
    `FEATURE_VISUAL_INSPECTION` is on.
    - Each photo shows its "AI observation", labelled _"A suggestion, not a finding. It may be
      wrong."_, with the flags in plain words, the model and prompt version, and the latest
      human response.
    - A photo still being analysed shows that it is in progress, and the page re-reads itself
      every 8 s for about two minutes. Leaving and returning loses nothing.
    - A blurry, dark or unrelated photo asks the reporter for a clearer one.
    - The section is a CSS container, so it lays out by its own width: side by side on the
      reporter's page, stacked in the staff pages' narrow action column. A preview check found
      the viewport-based version overflowing there.
12. **`GET /api/complaints/[id]/visual-analysis`** (plan §12) returns each photo's state, analysis
    and latest response. It is 404 while the feature is off or the ticket is not visible.

### Evaluation (A2.03, F1.06)

13. **Synthetic set, by the owner's choice (2026-11-05).**
    - The set is 40 drawings generated deterministically by
      `scripts/generate-visual-dataset.mts`: 28 clear, 4 blurry, 3 dark, 3 contradicting their
      report, and 2 unrelated. One case carries a prompt injection.
    - `pnpm eval:visual` runs the worker's exact code path against the live model and writes
      `docs/evidence/a2-visual-eval-visual-v1.md`.
    - The report is labelled a synthetic scenario evaluation, not real-photo accuracy (plan:
      "no claims of certainty").

## Testing without a live provider

The E2E Gemini stub answers image requests with structured JSON. It returns 400 unless the
inline data really is an image, and markers in the report script blurry, mismatched,
overconfident, malformed and rate-limited answers. The local worker reaches it at
`host.docker.internal:3199` (Docker only, from `supabase/config.toml`). Integration tests start
the stub when it is not running.

## Rollback

1. Switch `FEATURE_VISUAL_INSPECTION` off: the Photos section and photo APIs disappear (404).
2. Or set the worker's `AI_ENABLED` to anything but `true`: jobs go to review as `AI_DISABLED`
   and the stored photos remain.

The schema is additive; never drop it as an emergency step.

## Consequences

- Each photo costs one model call (plus retries for transient failures) on the free tier.
  Analyses use the vision model's quota, separate from triage when `GEMINI_VISION_MODEL` is set.
- Changing the prompt means a new `VISUAL_PROMPT_VERSION`. New photos are then analysed under
  it, and older analyses keep their own version. Re-analysing photos that were already analysed
  would need a new job per photo, which is not built.
