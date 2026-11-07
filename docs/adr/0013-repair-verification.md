# ADR 0013: Before/after repair verification

- **Status:** Accepted
- **Date:** 2026-11-07
- **Phase:** A5 (Advanced Features add-on, F4)

## Context

Plan v2 §09 (F4.01–F4.06) and phase A5 ask for:

- private before/after repair photos, uploaded by staff only;
- a paired-image Gemini comparison through the queue, with a versioned, validated result that
  says outright that no functional test was done;
- a verification view for staff, reporters and administrators;
- closing that always needs a person, and a dispute that reopens the work without losing
  evidence;
- 30 labelled before/after pairs, with the false-acceptance cases recorded.

**Gate A5:** repair photos are private; the AI result is traceable; closing requires human
confirmation; a disputed repair reopens the work order without losing evidence.

## Decisions

### Repair photos (F4.01)

1. **Repair photos reuse the A1 evidence pipeline** with the case as parent: reserve, signed direct
   upload, server byte check, finalise. `repair_evidence` labels each photo `before` or `after`.
   - Only the department holding the case and administrators may add them, while the case is
     being worked on (`assigned`, `in_progress`, `reopened`, `resolved`). A reporter gets
     `MR403`; another department gets `MR404`.
   - Photos are never replaced: `repair_evidence` is append-only, and the A1 Storage policies
     allow no updates. At most 12 photos per case.
   - Only one after photo waits for a decision at a time. Another is allowed once that one is
     decided (for example after rework).
2. **Who sees them.** Staff with the case, administrators and the reporters of the case's own
   reports. Reporters still cannot list case links (an A0 guarantee). They read through
   `repair_verification_view(complaint_id)`, which applies the same visibility rule as their
   complaint and returns nothing about other reports. A before photo taken from another reporter's
   report is never shown to them.

### The comparison (F4.02–F4.03)

3. **Finalising an after photo opens a `verification_reviews` row and queues `repair_verify`** in
   the same transaction. The before photo is the latest staff before photo, or else the first
   photo a reporter attached to one of the case's reports.
4. **The worker compares both photos in one Gemini call** (structured JSON output, prompt
   `verify-v1`). Both photos are re-checked byte for byte against what was finalised (the A2
   download helper, now shared). The answer must list what is visible before and after, the
   visible changes and what cannot be seen, and must contain
   `functional_test_not_performed: true`. An answer without it is refused (`INVALID_OUTPUT`).
5. **A deterministic policy can only make the answer more cautious**, never more confident:

   | Condition                                                         | Stored at least                  |
   | ----------------------------------------------------------------- | -------------------------------- |
   | The photos show different places or objects                       | `not_comparable`                 |
   | Not clearly the same scene, while the model said improved         | `inconclusive`                   |
   | A blurry or dark photo                                            | `inconclusive`                   |
   | Unqualified wording such as "fully repaired" or "works perfectly" | `inconclusive`, wording replaced |
   | No before photo at all (no model call)                            | `not_comparable`                 |

   Hedged sentences ("whether it is fixed cannot be seen") are not overclaims.

6. **The result is a suggestion.** `worker_save_verification` stores it on the review
   (idempotent per job), records an agent event on the case, and changes no status. pgTAP checks
   that a "visually improved" result leaves the case and its reports exactly where they were.

### People decide (F4.04–F4.05)

7. **No new status.** "Proposed resolved, under verification, closed or rework" maps onto the
   existing lifecycle: the department marks the ticket resolved (proposed resolved), the review
   waits (under verification), then a person closes or reopens it. Adding a case status would have
   rippled through every ticket mapping, queue and screen for no extra safety.
8. **Decisions go through the audited ticket transitions**, so notes, events and versions work as
   before.
   - The reporter's usual "Is it fixed?" buttons, or `POST /api/cases/[id]/verification-decision`,
     confirm or dispute their own report.
   - An administrator's decision leads the whole shared case (ADR 0011).
   - Departments cannot judge their own repair (`MR403`).
   - A decision names the open review; one already settled is `MR412` (HTTP 409).
9. **A trigger settles the open review whenever a person closes, reopens or merges the case**,
   whichever path they used: `confirmed`, `rework` or `superseded`, with who and when, and a
   `verification_decided` case event.
10. **A dispute reopens the work with nothing lost.** The work order stays active (the case was
    never closed), every photo and review is kept, and staff can add a new after photo for a new
    verification.

### Interface (F4.04)

11. **"Repair verification" panel**, behind `FEATURE_REPAIR_VERIFICATION`, on the department,
    admin and reporter ticket pages:
    - before and after thumbnails (five-minute signed URLs);
    - the AI suggestion in words ("Looks improved", "May not be fixed", "Inconclusive",
      "Not comparable"), with its observations, what cannot be seen, flags, model and prompt,
      and "no functional test";
    - the decision state and note;
    - for staff, before/after upload buttons (hidden while an after photo awaits a decision).
12. **APIs (§12):**
    - `POST /api/cases/[id]/repair-evidence` and `.../repair-evidence/finalize` (staff);
    - `POST /api/cases/[id]/verification-decision` (reporter or admin).

    With the flag off they answer 404.

### Evaluation (F4.06, A5.04)

13. **30 drawn before/after pairs** (`pnpm dataset:verification`):
    - 14 fixed, 5 unfixed, 3 partly fixed;
    - 4 with a dark or blurred after picture, 4 showing a different object.

    Each is labelled with what a person sees in the two pictures. `pnpm eval:verification` runs
    them against the live model through the worker's own prompt, call and policy, and records
    agreement, false acceptances and the confusion matrix in
    `docs/evidence/a5-verification-eval.md`. The report states that agreement is not engineering
    or safety assurance. The free tier answered "unavailable" for whole stretches of both runs, so
    each run is kept as its own file (`-run1`, `-run2`) rather than merged.

14. The drawing code of the A2 set moved to `scripts/lib/scenes.mts`, shared by both generators.
    The A2 images are byte-for-byte unchanged.

## Consequences

- One comparison costs one Gemini call with two small images; none without a before photo.
- Photo evidence cannot prove a repair works. The suggestion only helps a person decide, and a
  wrong "looks improved" still needs that person's confirmation.
- Reporters of a shared case see the case's staff repair photos, but never another reporter's
  report photos.
- Deploying needs no new secrets (the worker reuses `GEMINI_VISION_MODEL`/`GEMINI_MODEL`). The
  cloud rollout is A7.
