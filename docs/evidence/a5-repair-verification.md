# Evidence: Add-on phase A5, F4 before/after repair verification

**Gate A5 (plan v2 §14, §09):** closure requires human action; the disagreement and reopen path
is tested. Repair photos are private, the AI result is traceable, and a disputed repair reopens
the work order without losing evidence.

Design decisions: [ADR 0013](../adr/0013-repair-verification.md). Evaluation:
[run 1](a5-verification-eval-run1.md) and [run 2](a5-verification-eval-run2.md).

## Task checklist

| ID    | Task                                                                  | Status | Evidence                                                                                                                  |
| ----- | --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| A5.01 | Before/after case evidence, staff-only upload                         | Done   | `repair_evidence`; `request_/finalize_repair_evidence_upload` (holding department or admin); A1 pipeline with case parent |
| A5.02 | Paired-image analysis, reviewed results, mismatch fallback            | Done   | `repair_verify` job, prompt `verify-v1`, caution policy; no before photo or a different scene gives `not_comparable`      |
| A5.03 | Student/admin human closure decision; reversible dispute; audit event | Done   | `decide_repair_verification` and the usual "Is it fixed?" buttons; a trigger settles the review; `verification_decided`   |
| A5.04 | Evaluate the labelled 30-pair sample                                  | Done   | 30 drawn pairs; two live runs, with the false acceptances listed                                                          |

Also covered:

- **F4.01:** wrong-role upload refused; photos never replaced.
- **F4.02:** answers must carry `functional_test_not_performed`; overclaims are replaced.
- **F4.03:** queued paired call, validated, versioned.
- **F4.04:** the verification view for staff, reporters and administrators.
- **F4.05:** the transition path, with events.
- **F4.06:** the evaluation, with an explicit "not safety assurance" statement.
- **§12:** `POST /api/cases/[id]/repair-evidence` (and `/finalize`) and
  `POST /api/cases/[id]/verification-decision`.

## Verify clauses, as tested

| Plan clause                                                                         | How it was shown                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student cannot impersonate a technician or replace an after photo (F4.01)           | pgTAP: a reporter gets `MR403`, another department `MR404`; repair rows cannot be relabelled. Integration: Storage refuses an overwrite by the reporter and by the uploader, and the bytes are unchanged. E2E: 403                                  |
| Wrong-role upload rejected (A5.01)                                                  | As above. Mutation check: removing the staff-only guard fails the pgTAP and integration tests                                                                                                                                                       |
| Model never returns an unqualified "fully repaired" (F4.02)                         | Unit: the schema requires `functional_test_not_performed: true`; overclaims become `inconclusive` with the wording replaced, hedged sentences do not. Integration: `STUB:VERIFY-OVERCLAIM` is stored inconclusive                                   |
| Missing or mismatched before photo gives INCONCLUSIVE/NOT_COMPARABLE (F4.03, A5.02) | Unit and integration: no before photo gives `not_comparable` (`MISSING_BEFORE`) with no model call; a different scene gives `not_comparable`; a dark after photo gives `inconclusive`. Eval: 4/4 different-object pairs were not comparable (run 2) |
| Admin closes shared cases; reporters confirm or dispute their own (F4.04)           | pgTAP: an admin's confirmation closes the case; a reporter's dispute reopens it; a department gets `MR403`. Integration and E2E: dispute through the API, confirmation through "Is it fixed?"                                                       |
| AI alone can never move a case to CLOSED (F4.05, A5.03)                             | pgTAP: storing a "visually improved" result leaves the case and the report `in_progress`. Integration: the case is unchanged after the comparison. E2E: the ticket stays `assigned` after the comparison                                            |
| Disputed repair reopens the work order without losing evidence (gate)               | pgTAP and integration: after a dispute the review is `rework` with who and why, the work order is still active, both photos are kept, and a new after photo opens a new verification                                                                |
| Repair photos are private (gate)                                                    | pgTAP and integration: another student and another department see no review, no photo and no view; reporters still cannot list case links (A0)                                                                                                      |
| Do not report raw AI agreement as safety assurance (F4.06)                          | Both evaluation reports say so in their first lines                                                                                                                                                                                                 |

## Live evaluation (30 drawn pairs, `gemini-3.1-flash-lite`, prompt `verify-v1`)

Gemini's free tier answered 503 ("high demand") for long stretches on 2026-11-07, even after the
queue's three attempts. Both runs are kept as they came out, unmerged:

| Run                                   | Answered | Agreement       | False acceptance  | Fixed pairs missed |
| ------------------------------------- | -------- | --------------- | ----------------- | ------------------ |
| [Run 1](a5-verification-eval-run1.md) | 25 / 30  | 23 / 25 (92.0%) | 2 (r22, r25)      | 0 of 14            |
| [Run 2](a5-verification-eval-run2.md) | 21 / 30  | 17 / 21 (81.0%) | 3 (r22, r25, r26) | 1 of 5 answered    |

Every pair was answered at least once across the two runs.

Honest reading:

- **The false acceptances are all the subtle cases:** a partly faded stain (r22) and two blurred
  after pictures the model rated as usable (r25, r26). The caution policy cannot downgrade what
  the model itself reports as a clear photo, so these stayed "looks improved". They are the
  reason the AI result is only a suggestion: closing still needs the reporter or an administrator.
- **The runs disagreed on one fixed pair:** r13 (a ceiling tile put back) was "improved" in run 1
  and "not comparable" in run 2. Repeated calls on the same images are not perfectly stable.
- Unfixed, partly fixed, dark-photo and different-object pairs were otherwise judged as labelled.
- 30 drawn pairs: real photos (angles, lighting, clutter) will be harder. This set checks the
  pipeline and the policy, not field accuracy.

## Screenshots (local preview; all add-on features on, AI routing off)

| View                                                                                       | File                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Department: a case being worked on, with "Add a before photo" and "Add an after photo"     | [department-upload.jpg](a5/department-upload.jpg)                 |
| Department: before/after thumbnails, "AI suggestion: Looks improved", waiting for a person | [department-comparison.jpg](a5/department-comparison.jpg)         |
| Reporter (phone): the repair photos above their own report                                 | [reporter-mobile-photos.jpg](a5/reporter-mobile-photos.jpg)       |
| Reporter (phone): "Is it fixed?" below the evidence                                        | [reporter-mobile-decision.jpg](a5/reporter-mobile-decision.jpg)   |
| Reporter (phone): after "Yes, it is fixed": "Repair confirmed by a person" and the notice  | [reporter-mobile-confirmed.jpg](a5/reporter-mobile-confirmed.jpg) |

The preview led to one change: while an after photo waits for a decision, the department sees
neither upload button, only an explanation. The console had no errors, and the phone layout had
no horizontal overflow.

## Local verification

Run on 2026-11-07 on `phase/a5-repair-verification` after `supabase db reset`. The first E2E
server has every flag OFF; the second has every add-on feature from A1–A5 on.

| Suite                        | Result                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`                  | Pass, 0 warnings                                                               |
| `pnpm typecheck` (tsc)       | Pass                                                                           |
| `pnpm format:check`          | Pass                                                                           |
| `pnpm test` (unit + DOM)     | **576 / 576** (17 new: contract, caution policy, prompt, paired-image handler) |
| `pnpm db:test` (pgTAP)       | **534 / 534** in 13 files (39 new in `013_repair_verification`)                |
| `pnpm test:integration`      | **148 / 148** (11 new: real Storage uploads, real worker, Gemini stub)         |
| `pnpm build`                 | Pass                                                                           |
| `pnpm test:e2e` (Playwright) | **225 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed     |

New E2E journeys (`repair-verification.spec.ts`), on desktop Chromium and Pixel 7:

- the department adds before and after photos through the real file chooser, the comparison
  appears, and the reporter confirms "Yes, it is fixed" (axe clean);
- the repair-evidence API (201, signed upload, finalise), a department refused its own verdict
  (403), a reporter refused an upload (403), a dispute (200, reopened) and a repeat decision (409);
- with the flag OFF there is no panel and both APIs answer 404.

The new spec passed 18/18 when repeated three times.

**Found while testing, fixed before the gate:**

- The overclaim check flagged an honest hedge ("whether it is fixed cannot be seen"). It now
  judges sentence by sentence and ignores hedged ones.
- Letting reporters read their own case-link rows broke an A0 privacy test ("a student sees no
  case links"). The test was kept: reporters read through `repair_verification_view` instead.
- An E2E assertion raced the worker: another test's worker call finished the comparison first and
  the page refreshed past the upload message. It now waits for the comparison card.
- After a `db reset` the local edge runtime stayed stopped, and the integration test's worker
  calls failed silently. The test's helper now fails on a non-200 answer.

**Not verified here:** the cloud. Migrations, the worker and the flag are not pushed; that is A7
with the owner's approval. Production is unchanged while `FEATURE_REPAIR_VERIFICATION` is unset.
