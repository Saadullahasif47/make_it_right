# Stage 4 gate: staff queue, inspection panel and admin pages

Recorded 2026-11-04 against local production builds on the local Supabase stack.

- **Before:** the Stage 3 branch at `4171e24`, built in a temporary worktree and served on port 3102.
- **After:** this branch, served on port 3100.

## What changed

- **One ticket table for every role** (`complaint-table.tsx`). Desktop gets a table, phones get compact rows. The
  columns depend on who is reading:
  - **Student:** reference, issue, status, reported.
  - **Staff:** reference, issue, priority, status, age, acknowledged. "High" priority uses the attention colour.
  - **Admin:** reference, issue, priority, status, department, age.
  - **Review queue:** reference, issue, why it waits, age.
- **Department queue:**
  - Filters: Active, Resolved, Closed, All. Sorts: oldest, most urgent, newest.
  - On desktop, a row opens an **inspection panel** with the description, actions and history. The panel is driven
    by `?ticket=`, so the view is a shareable URL.
  - Actions taken in the panel return to the queue with the same ticket open. The return path is built on the
    server, and the form can only choose between two fixed destinations (`workflowReturnPath`).
  - While the panel is open, the table drops to reference, issue, priority and status, and shows "New" beside the
    status, so titles stay readable.
  - On phones a row opens the full ticket page. A shared `?ticket=` link still shows the panel, above the list.
  - A forged or foreign id opens no panel: RLS returns nothing.
- **Admin Tickets (new page, `/admin/tickets`):** every ticket, with search (the Stage 3 `p_query`), status
  filter, sort and keyset pagination. It is added to the admin navigation (four destinations).
- **Review queue:** the same table, with the reason each ticket waits: "AI asked for a person", "AI attempt
  stalled", "AI is routing it" or "Not routed yet".
- **Ticket pages for staff and admin:** a workbench. The record (details, description and the full history) is on
  the left, and the actions (route, AI routing, workflow) are on the right, so the history is never buried under
  forms.
- **Overview:** the same real metrics in a tighter grid. KPIs sit in two columns on phones and four from 1024 px;
  panel padding and gaps are smaller.
- **Departments:** availability is now a table, and on phones the routing count folds into the name.

### A deliberate deviation

The plan suggested routing rows that "save on change". Submitting a select as soon as it changes reloads the page
and moves focus, which goes against WCAG 3.2.2 (On Input). Each routing row keeps its explicit **Save** button, and
the confirmation toast is unchanged.

## Problems the audit found, now fixed

1. **Contrast:** the selected row's reference used the subtle grey on the selection tint. It now uses the muted ink.
2. **Overflow at 390 px on every admin page:** the phone tab bar sat in a flex child without `min-w-0`, so it pushed
   the page wider instead of fitting. The fix adds `min-w-0` and a short phone label ("Review"), so all four tabs fit
   without scrolling.
3. **Titles squeezed beside the panel:** fixed by the compact columns described above.

The audit script also had a bug: it skipped the remaining roles after one failure. Every role is now audited in one
run.

## Tests

| Suite                        | Result                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, `queues.test.ts` (new) | ticket age bands, review reasons, and the panel return path (other values and other roles cannot redirect elsewhere)                                                                                                                                          |
| E2E, `queues.spec.ts` (new)  | desktop: panel opens, acts in place, stays shareable, full page and close links. Pixel 7: a row opens the full page. A forged id opens nothing. Admin table: search by reference, department column, filter keeps search, clear, open a ticket, staff refused |
| E2E, existing                | the Gate P3 three-role journey now runs through the panel on desktop. Agent, admin and complaints specs pass on desktop and Pixel 7                                                                                                                           |

## Screens, axe and overflow

`pnpm design:audit:app` (`scripts/design-audit-app.mts`, localhost only) creates a throwaway student, staff member
and admin, and files four reports through the API. It then audits each role's screens at 390, 768, 1366 and 1440 px
in light mode, and at 390 and 1440 px in dark mode.

| Build  | Student | Staff | Admin | axe violations (WCAG 2.2 AA) | Horizontal overflow |
| ------ | ------- | ----- | ----- | ---------------------------- | ------------------- |
| Before | n/a     | 18    | 30    | 0                            | none                |
| After  | 24      | 18    | 30    | 0                            | none                |

`/admin/tickets` does not exist before this stage, so its "before" capture is the 404 page and is not kept.
