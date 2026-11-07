# Evidence: A5 repair verification evaluation, run 1 (30 synthetic pairs)

> **Synthetic scenario evaluation.** 30 drawn before/after pairs written for this test
> (`scripts/generate-verification-dataset.mts`), labelled by what a person sees in the two
> pictures. Agreement with these labels is **not** engineering or safety assurance: a photo
> cannot show that a repair works, and every case still needs a person's confirmation (F4.06).

- Run: 2026-11-07, model `gemini-3.1-flash-lite`, prompt `verify-v1`
- Code path: the worker's prompt, paired-image call and caution policy (one request per pair)
- Pairs: 14 fixed, 5 unfixed, 3 partly fixed, 4 with a dark or blurred after picture, 4 showing a
  different object

## Results

| Measure                                                        | Value                               |
| -------------------------------------------------------------- | ----------------------------------- |
| Pairs answered                                                 | 25 of 30                            |
| Agreement with the person's label                              | **23 / 25 (92.0%)**                 |
| False acceptance (said "looks improved", label says otherwise) | **2** (r22-partial, r25-poor_after) |
| Fixed pairs not recognised as improved                         | 0 of 14                             |
| Answers made more cautious by the policy                       | 0                                   |
| Provider errors (retried as the queue would)                   | 16                                  |

## Confusion (rows: person's label, columns: stored suggestion)

| Label \ Suggestion  | visually_improved | possibly_unresolved | inconclusive | not_comparable |
| ------------------- | ----------------- | ------------------- | ------------ | -------------- |
| visually_improved   | 14                | 0                   | 0            | 0              |
| possibly_unresolved | 1                 | 7                   | 0            | 0              |
| inconclusive        | 1                 | 0                   | 2            | 0              |
| not_comparable      | 0                 | 0                   | 0            | 0              |

## Every pair

| Pair           | Kind       | Label               | Model said          | Stored                                                                       | Flags                          | Agrees |
| -------------- | ---------- | ------------------- | ------------------- | ---------------------------------------------------------------------------- | ------------------------------ | ------ |
| r01-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r02-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r03-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r04-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r05-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r06-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r07-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r08-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r09-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r10-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r11-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r12-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r13-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r14-fixed      | fixed      | visually_improved   | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | yes    |
| r15-unfixed    | unfixed    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r16-unfixed    | unfixed    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r17-unfixed    | unfixed    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r18-unfixed    | unfixed    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r19-unfixed    | unfixed    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r20-partial    | partial    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r21-partial    | partial    | possibly_unresolved | possibly_unresolved | possibly_unresolved                                                          | PARTLY_NOT_VISIBLE             | yes    |
| r22-partial    | partial    | possibly_unresolved | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | **no** |
| r23-poor_after | poor_after | inconclusive        | inconclusive        | inconclusive                                                                 | AFTER_DARK, PARTLY_NOT_VISIBLE | yes    |
| r24-poor_after | poor_after | inconclusive        | inconclusive        | inconclusive                                                                 | AFTER_DARK, PARTLY_NOT_VISIBLE | yes    |
| r25-poor_after | poor_after | inconclusive        | visually_improved   | visually_improved                                                            | PARTLY_NOT_VISIBLE             | **no** |
| r26-poor_after | poor_after | inconclusive        | -                   | no answer (PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE) | none                           | **no** |
| r27-different  | different  | not_comparable      | -                   | no answer (PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE) | none                           | **no** |
| r28-different  | different  | not_comparable      | -                   | no answer (PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE) | none                           | **no** |
| r29-different  | different  | not_comparable      | -                   | no answer (PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE) | none                           | **no** |
| r30-different  | different  | not_comparable      | -                   | no answer (PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE, PROVIDER_UNAVAILABLE) | none                           | **no** |

## Reading

- The safety-relevant error is false acceptance: a suggestion of "looks improved" for a repair
  that is not visibly done. Even then nothing closes on its own; the reporter or an administrator
  must confirm, and a dispute reopens the work.
- "Inconclusive" and "not comparable" ask a person to look; they cost time, not safety.
- 30 drawn pairs and one run: one pair moves agreement by about 3 points. Real photos (angles,
  lighting, clutter) will be harder; this set checks the pipeline and the policy, not field accuracy.
