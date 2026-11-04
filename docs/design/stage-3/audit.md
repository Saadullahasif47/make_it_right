# Stage 3 gate: student list, search, report form and ticket detail

Recorded 2026-11-04 against local production builds on the local Supabase stack.

- **Before:** `main` at `8168b29`, built in a temporary worktree and served on port 3102.
- **After:** this branch, served on port 3100.

## What changed

- **My complaints:**
  - a summary strip: open, awaiting your confirmation (resolved) and closed;
  - search by title, building, room or reference (`MIR-1234`, `mir1234` or `1234`);
  - status filters that keep the search, and a search that keeps the filter;
  - a table on desktop and compact rows on phones;
  - an empty state for a search that finds nothing, with a way to clear it.
- **Report an issue:** fields grouped as _The problem_ (title, description) and _The place_ (building, room).
  Validation, the character count, submit progress and the one-key idempotent submit are unchanged.
- **Ticket detail:** a single reading column. When a ticket is resolved, the student's decision (confirm, or reopen
  with a reason) comes straight after the header. The details, description and full-width history follow. Staff and
  admin keep the two-column layout until Stage 4.

## The one backend change (plan §5)

`supabase/migrations/20261104120000_list_complaints_search.sql` adds an optional `p_query` to `list_complaints`.

- It is still `SECURITY INVOKER`, so RLS limits a search to the tickets the caller may already see.
- It matches with `strpos`, not `LIKE`, so `%` and `_` are ordinary characters.
- It refuses text longer than 100 characters (`22023`). The API returns a field error first.

## Tests

| Suite                                  | Result                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP, `007_complaint_search.test.sql` | 22 new, 244 in total, all passing                                                                                                                                             |
| pgTAP, mutation checks                 | made `SECURITY DEFINER`: 7 tests fail (RLS and invoker checks). `LIKE` instead of `strpos`: 3 tests fail (wildcards). Both restored and green                                 |
| Integration, `complaints-api.test.ts`  | 5 new (owner finds by every field, another student and unassigned staff find nothing, admin finds by reference, counts are scoped, long text refused)                         |
| Unit, `schemas.test.ts`                | the search limit matches the SQL; trimming, wildcard text and refusals                                                                                                        |
| E2E, `complaints.spec.ts`              | 22 of 22 pass on desktop and Pixel 7, including a new search journey (text, reference, filter, clear, wildcard, API, another student). Double submit still creates one ticket |

## Screens, axe and overflow

`pnpm design:audit:student` (`scripts/design-audit-student.mts`, localhost only; Stage 4 generalised it to `pnpm design:audit:app --roles student`) creates a throwaway student, files
four reports through the real API, moves one to resolved and one to in progress, and audits four screens. It captures
`/student/complaints`, `?q=library`, `/student/complaints/new` and the resolved ticket at 390, 768, 1366 and 1440 px in
light mode, and at 390 and 1440 px in dark mode. Then it deletes the student.

| Build  | Screens | axe violations (WCAG 2.2 AA) | Horizontal overflow |
| ------ | ------- | ---------------------------- | ------------------- |
| Before | 24      | 0                            | none                |
| After  | 24      | 0                            | none                |

On `main` the search screen shows the unfiltered list, because `main` ignores `q`.

## Screenshots kept here

Before and after: the list at 390 and 1440 px, the form at 1440 px, and the resolved ticket at 390 and 1440 px. After
only: a search at 1440 px, and the list in dark mode at 1440 px.

Full-page captures cut the sticky desktop sidebar at the first viewport height. In a browser it stays in view as you
scroll.
