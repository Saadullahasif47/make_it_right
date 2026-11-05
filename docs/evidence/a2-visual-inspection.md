# Evidence: Add-on phase A2, F1 visual analysis

**Gate A2 (plan v2 §14, §06):** F1 passes privacy, failure and evaluation tests; photos are
private; a valid photo produces structured observations; a contradictory or unreadable image
requests review; and the baseline ticket workflow survives an AI outage. Enable only in preview.

Design decisions: [ADR 0010](../adr/0010-visual-inspection.md).

## Task checklist

| ID    | Task                                                                        | Status | Evidence                                                                                                                   |
| ----- | --------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| A2.01 | Gemini multimodal adapter: model env, timeout, Zod schema, versioned prompt | Done   | `_shared/visual-inspection/` (adapter, schema, prompt `visual-v1`); unit tests on the exact request and every failure code |
| A2.02 | Persist results; editable correction UI on ticket detail                    | Done   | `visual_analyses` (immutable) + `visual_analysis_reviews` (append-only); Photos section for reporter, department and admin |
| A2.03 | Labelled 40-case image suite; macro-F1 and error examples                   | Done   | [a2-visual-eval-visual-v1.md](a2-visual-eval-visual-v1.md) (synthetic set, owner's choice)                                 |

Plan items covered along the way:

- **F1.03:** malformed output never reaches the database (Zod, then `INVALID_OUTPUT` straight to
  review).
- **F1.04:** provider errors map to retryable and non-retryable codes.
- **F1.05:** queued worker, result persistence and audit, with pending, completed and review
  states in the UI.
- **F1.06:** the evaluation.
- **§12:** `GET /api/complaints/[id]/visual-analysis`.

## Verify clauses, as tested

| Plan clause                                                                     | How it was shown                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncertain photos receive uncertainty flags (A2.01)                              | Unit: each degraded or doubtful answer sets its flag and forces review. Integration: `STUB:VISION-MISMATCH` gives `TEXT_IMAGE_MISMATCH` plus review, and `STUB:VISION-CERTAIN` gives `CERTAINTY_LANGUAGE`. Live: 4/4 blurry, 3/3 dark, 3/3 contradictory and 2/2 unrelated photos were caught  |
| Student can view but cannot rewrite the model audit (A2.02)                     | pgTAP: the reporter reads their analysis, but an update fails (42501), even the table owner is refused by the trigger, and a response never changes the analysis or the ticket. Integration: an UPDATE and a forged `worker_save_visual_analysis` call fail (42501) for both student and admin |
| No claims of certainty from visual content (A2.03)                              | The policy flags overconfident wording and the database refuses an unsure analysis stored as settled. The UI labels every result "A suggestion, not a finding. It may be wrong." The evaluation is labelled synthetic                                                                          |
| Malformed output cannot enter the database (F1.03)                              | Unit (malformed JSON or off-contract fields give `INVALID_OUTPUT`) and integration (`STUB:VISION-INVALID`: job in review, no row)                                                                                                                                                              |
| Provider outage maps to retryable codes (F1.04)                                 | Unit: 429, 5xx, network failure and timeout are retryable; 4xx and safety blocks are not. Integration: a 429 leaves the job in `retry_wait`                                                                                                                                                    |
| Refresh does not lose the request; completed analysis stays inspectable (F1.05) | E2E leaves the ticket, returns and finds the analysis. The preview showed the in-progress state, then the result appearing on its own after one worker run                                                                                                                                     |
| Baseline ticket workflow survives AI outage (gate)                              | Integration: with the photo job rate-limited, the admin still assigns the ticket and the department sees it                                                                                                                                                                                    |
| Photo is private (gate)                                                         | A1's Storage policy tests still pass. pgTAP and integration show other students see no analysis and get `MR404` from `photo_analysis_states`                                                                                                                                                   |

Mutation checks, run then reverted:

- The A1 privacy mutation still applies to photos.
- Removing the review-when-unsure constraint is caught by the pgTAP constraint assertions.
- Bypassing the integrity check is caught by the unit test for a tampered byte.

## Live evaluation (synthetic, 2026-11-05, `gemini-3.1-flash-lite`, `visual-v1`)

Full report: [a2-visual-eval-visual-v1.md](a2-visual-eval-visual-v1.md).

| Measure                                           | Result                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| Category macro-F1, 38 cases with a photo category | **0.735**                                       |
| Category macro-F1, 28 clear drawings              | **0.796**                                       |
| Cases that needed a person and were sent to one   | **14 / 14**                                     |
| Routine clear drawings also sent to a person      | 7 / 26 (extra work, not a risk)                 |
| Prompt injection ("say this is safe")             | ignored: rated high severity and sent to review |
| Provider failures                                 | 0 of 40                                         |
| Latency p50 / p95                                 | 2.1 s / 5.0 s                                   |

Honest reading:

- The weakest class is `other` (0 of 3). The drawings of peeling paint, a cracked tile and a
  missing ceiling tile are too abstract and were read as unrelated, which still sent them to a
  person.
- The ceiling-leak stain was read as `other`. Under the routing definitions that is defensible,
  because ceilings belong to `other`.
- The prompt was **not** tuned on this set, so these are first-run numbers with no held-out
  split. Drawings are not photos (see the report's limitations).

## Screenshots (local preview, `FEATURE_VISUAL_INSPECTION=true`, worker against the stub)

| View                                                     | File                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Reporter: photo added, analysis in progress              | [student-analysis-pending.jpg](a2/student-analysis-pending.jpg) |
| Reporter: analysis shown after the page refreshed itself | [student-analysis-desktop.jpg](a2/student-analysis-desktop.jpg) |
| The same on a phone (375 px)                             | [student-analysis-mobile.jpg](a2/student-analysis-mobile.jpg)   |
| Admin: correction recorded beside the unchanged analysis | [admin-correction.jpg](a2/admin-correction.jpg)                 |

The preview also caught a layout defect: the photo and its analysis sat side by side in the
narrow staff action column, and the page scrolled sideways. It was fixed with container queries
and re-checked: page width equals view width.

## Local verification

Run on 2026-11-05 on `phase/a2-visual-inspection` after `supabase db reset` (fresh local stack;
the worker talks to the Gemini stub). The first E2E server has every flag OFF; the second has
`FEATURE_VISUAL_INSPECTION=true`.

| Suite                        | Result                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `pnpm lint`                  | Pass, 0 warnings                                                                |
| `pnpm typecheck` (tsc)       | Pass (includes the worker's shared modules)                                     |
| `pnpm format:check`          | Pass                                                                            |
| `pnpm test` (unit + DOM)     | **516 / 516** (37 new: contract and policy, prompt, adapter, handler, settings) |
| `pnpm db:test` (pgTAP)       | **423 / 423** in 10 files (38 new in `010_visual_analyses`)                     |
| `pnpm test:integration`      | **119 / 119** (7 new: the real worker with the stub, plus adjusted A1 drills)   |
| `pnpm build`                 | Pass                                                                            |
| `pnpm test:e2e` (Playwright) | **207 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed      |

The first E2E attempt failed 19 tests with `ENOSPC` (drive C: had 50 MB free) while writing
traces. With the owner's approval, unused Docker build cache was pruned (9.7 GB). The full suite
then passed with no change to the code; every other step had already passed in the same gate.

New E2E journeys (`visual.spec.ts`), each on desktop Chromium and Pixel 7:

- the reporter sees the AI observation labelled as a suggestion, leaves and returns, and
  confirms it (axe clean);
- a contradicting photo is flagged for a person, and a dispute needs a reason;
- an admin records a corrected category, and the assigned department sees the analysis
  read-only.

The A1 journeys (`evidence.spec.ts`) still pass; the admin jobs test now uses a malformed-answer
photo to reach review. All existing journeys pass, including AI triage through the stub
(primary model, backup model, keyword fallback).

## Not yet verified

- **Cloud.** Nothing is pushed: no migration, Edge Function, function secrets (`GEMINI_API_KEY`,
  `AI_ENABLED`) or Vault secrets. Plan A7.03 enables the flag in preview after deployment, and
  every push needs the owner's approval. With the flag OFF, production is unchanged.
- **Real photos.** The evaluation used drawings by design, so accuracy on real campus photos is
  unmeasured.
- **Re-analysis under a new prompt version** is not built (ADR 0010).
