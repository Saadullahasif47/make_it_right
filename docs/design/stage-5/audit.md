# Stage 5 gate: motion, reduced motion, keyboard and final polish

Recorded 2026-11-04 against a local production build of this branch on the local Supabase stack.

## Motion pass (plan §3)

- **Motion inventory:** every transition in `src/` is 150 ms (colour, background or border), 200 ms (toast, badge
  crossfade) or 250 ms (the landing drawer). All use the single `ease-out-soft` curve.
- **No hover transforms:** nothing in `src/` uses `hover:translate`, `hover:scale`, `active:scale` or a hover shadow
  lift.
- **Fix:** the admin KPI tiles are not interactive, but they changed border on hover and declared a transform
  transition, which suggested they could be clicked. They are now static.
- **Reduced motion:** the global `prefers-reduced-motion` rule shortens every animation and transition to 0.01 ms and
  stops loops, including the skeleton pulse and the submit spinner. A pending button still says "Submitting…", so
  its state never depends on movement.

## Tests

| Suite                         | What it proves                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E, `motion.spec.ts` (new)   | on `/` and `/login`: the longest transition is between 0 and 250 ms; with reduced motion, every transition and animation is at most 0.01 ms; the main heading is visible at once                                                                                                                                                                                    |
| E2E, `keyboard.spec.ts` (new) | each role's main job with Tab, Enter and typing only, with a visible focus indicator on every stop used: a student signs in, uses the skip link, opens the form, files a report; staff open a ticket in the queue panel, acknowledge and start work; an admin opens a waiting ticket from the review queue, picks a category and priority by typing, and assigns it |

Writing the keyboard test surfaced one detail. Form fields show focus as a brand border plus a soft ring (a box
shadow), not an outline. Both count as a visible indicator, and the test accepts either.

## Reduced-motion screenshots

Every capture by `pnpm design:audit` and `pnpm design:audit:app` runs with `reducedMotion: "reduce"`. On this build:

| Area                   | Screens (390, 768, 1366, 1440 light; 390, 1440 dark) | axe violations | Horizontal overflow |
| ---------------------- | ---------------------------------------------------- | -------------- | ------------------- |
| Public (landing, auth) | 24                                                   | 0              | none                |
| Student                | 24                                                   | 0              | none                |
| Department staff       | 18                                                   | 0              | none                |
| Admin                  | 30                                                   | 0              | none                |

Kept here: the landing page at 390 px, sign-in in dark mode at 1440 px, the student list in dark mode at 1440 px, the
staff panel opened from a shared link at 390 px, the admin overview at 1440 px, and the admin ticket at 390 px.

## Production smoke

The gate requires 27 / 27 on production after the final merge. That result is recorded in the release notes of the
merge, not here, because it can only run once this branch is live.
