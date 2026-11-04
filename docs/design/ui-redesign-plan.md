# UI redesign plan

Status: approved 2026-11-03; Stage 1 delivered 2026-11-04; Stage 2 delivered 2026-11-04 (gate record in
`docs/design/stage-2/audit.md`); Stage 3 delivered 2026-11-04 (`docs/design/stage-3/audit.md`); Stage 4 delivered 2026-11-04
(`docs/design/stage-4/audit.md`); Stage 5 delivered 2026-11-04 (`docs/design/stage-5/audit.md`). Baseline: tag `v1.0.0` (`dd687ea`), which we can roll back to at
any time.

## 1. Audit

### What exists

- **Stack:**
  - Next.js 16 App Router with Cache Components;
  - Tailwind CSS 4, with tokens in `src/app/globals.css`;
  - Lucide icons;
  - Plus Jakarta Sans and JetBrains Mono.
  - No component library: 7 shared components in `src/components`, plus feature components.
- **14 screens:**
  - public: landing, sign-in, sign-up, forgot password, set new password, 404 and error pages;
  - student: my complaints, report an issue, complaint detail;
  - staff: department queue, ticket detail;
  - admin: overview dashboard, review queue, ticket detail and routing, departments.
- **App shell:** a top bar with the logo, account and sign-out, and tab links underneath. There is
  no sidebar.

### Problems found

**Visual identity**

1. **Two accent colours.** Pine teal is the brand colour, and amber is used decoratively (role
   icons, priority pills, "New" counts). The second accent dilutes the brand.
2. **Status colours don't tell states apart.** Assigned, in progress, resolved and closed are all
   the same green pill. Only "submitted" differs.
3. **Headings are too heavy.** `font-extrabold` (800) on every page title makes the app shout.
   Small uppercase eyebrows ("STUDENT", "ADMINISTRATOR") repeat information the navigation already
   gives.
4. **Corners are too round for an operational tool.** `rounded-2xl`/`3xl` (16–40 px) is used
   22 times, and every surface is a card with a shadow.

**Motion** (inventory from the code)

5. Many animations are decorative or too slow:
   - a 0.7 s `fade-up` on every page header and empty state (22 uses);
   - a 6 s infinite `float`;
   - an infinite `pulse-ring`;
   - a sheen sweep on primary buttons;
   - every button lifts 2 px on hover;
   - stat tiles lift;
   - `scale-110` on some icons.
6. **A real bug.** The hero ticket preview reveals its steps with `animation-delay`. With "reduce
   motion" switched on, the delay still applies, so half the card stays empty (seen in the audit
   screenshot). Content must never depend on an animation finishing.

**Layout and UX**

7. **Landing page.**
   - Two sections use the same three-card grid ("How it works", "roles").
   - The AI section is a large dark gradient card with a radial glow.
   - The grid-pattern background is decorative.
   - The hero headline wraps over 4 lines.
8. **Student list.**
   - There's no search.
   - Each row is a large card, so only about 5 tickets fit on a laptop screen.
   - On a phone, the location wraps and leaves a stray "·" at the start of a line.
9. **Staff queue.** Rows are the same large cards, with no density or at-a-glance priority, and the
   staff member has to open each ticket separately.
10. **Admin ticket page.**
    - The left column ends after the description, while the right column stacks four panels
      (route, AI, work note, history). The history is buried at the bottom, and on a phone it
      comes after every form.
    - The wrong tab is highlighted: "Overview" is active when you arrive from the review queue.
11. **Admin has no list of all tickets.** There's only the dashboard and the review queue, so
    complaint management needs a filterable table.
12. **Departments page.** Six bright "Save" buttons, one per routing row, and full-width selects
    make a calm settings page noisy.
13. **Feedback.** Success and failure appear as a banner via `?notice=` in the URL. There are no
    toast notifications.

### What must be preserved

- Every route, API, form action, server check, Supabase query, RLS rule, SQL function and Gemini
  path. This is a presentation-layer redesign.
- The accessible names of buttons, links, fields and headings. The 151 E2E tests find elements by
  these. Where a label really should change, the test changes in the same PR, deliberately.
- What already works well:
  - real-data metrics;
  - the timeline;
  - the "saved first" messaging;
  - the prototype disclaimer;
  - visible focus;
  - axe-clean pages;
  - dark mode.

## 2. Visual identity

| Token       | Light                    | Use                                                                                         |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `canvas`    | `#F6F8F7`                | Page background                                                                             |
| `surface`   | `#FFFFFF`                | Panels, inputs, table rows                                                                  |
| `ink`       | `#182D2B`                | Primary text (13.6:1 on canvas)                                                             |
| `ink-muted` | derived, ≥ 4.5:1         | Secondary text                                                                              |
| `line`      | `#E1E7E4`                | Borders, dividers                                                                           |
| `brand`     | `#176B5B`                | The only accent: primary actions, links, selection (6.0:1 on canvas, 6.4:1 with white text) |
| `sidebar`   | `#182D2B`                | App sidebar, with light text                                                                |
| Status hues | muted, with a text label | Distinct per state, never colour alone                                                      |

- **Dark mode is kept.** The same tokens are re-derived for dark backgrounds, because the current
  app supports it and visitors' phones may be in dark mode.
- **Type: Geist and Geist Mono.**
  - Geist Mono is for ticket references (`MIR-1024`).
  - Weights: 600 for headings and 500 for UI labels; 800 is no longer used.
  - Size scale: 12, 13, 14, 16, 20, 24, 30 and 40 (hero only).
- **Spacing:** a 4 px base. Layout uses only 4, 8, 12, 16, 24, 32, 48 and 64.
- **Radius:**
  - 6 px: inputs and small controls;
  - 8 px: buttons;
  - 12 px: panels.
  - Nothing larger.
- **Shadows:**
  - none on panels at rest; borders do the work;
  - one subtle shadow for menus, popovers and toasts;
  - one for dialogs.
- **Icons:** Lucide only, 16 px in UI and 20 px in empty states, 1.75 px stroke.
- **Not used:**
  - gradients or glows;
  - blobs or grid patterns;
  - glass effects;
  - decorative 3D;
  - emoji;
  - amber decoration. Amber stays only as the meaning "needs attention", for example high
    priority.

**Components** (`src/components/ui`, one variant API each)

- Button, IconButton, Link button;
- Input, Textarea, Select, Field with hint and error;
- Badge (status and priority), Avatar;
- Panel, PageHeader, Toolbar (search, filters, sort);
- DataTable with sortable headers, plus a responsive row list for phones;
- Tabs or segmented filter, Dropdown menu, Drawer (mobile navigation and the staff inspection
  panel), Dialog;
- Toast, Skeleton, EmptyState, ErrorState, Timeline;
- Sidebar, MobileNav.

**No large UI library.**

- shadcn/ui would bring Radix and its CSS conventions for only a few widgets.
- These primitives are small, and native `<dialog>` and `popover` cover focus trapping.
- They follow shadcn's API style, so moving to it later stays easy.
- Motion (the animation library) is not added. CSS transitions cover everything on this list.

## 3. Motion system

| Interaction                  | Duration | Property                   |
| ---------------------------- | -------- | -------------------------- |
| Button and link hover, press | 150 ms   | colour, background, border |
| Interactive rows and cards   | 150 ms   | background, border colour  |
| Menus, popovers              | 200 ms   | opacity, translateY(4 px)  |
| Drawer, dialog               | 250 ms   | opacity, translateX/Y      |
| Tabs and filters             | 150 ms   | indicator position, colour |
| Status change confirmation   | 200 ms   | badge colour crossfade     |
| Toast enter and exit         | 200 ms   | opacity, translateY        |

- **Easing:** one `ease-out` curve.
- **No movement on hover:** no lift, no scale. A press darkens the control, and there is no
  bounce.
- **Removed:**
  - `float`;
  - `pulse-ring`;
  - the button sheen;
  - page-header `fade-up`;
  - delayed step reveals.
- **Page content appears at once.** At most a 150 ms opacity fade for the main region, and never
  on scroll.
- **`prefers-reduced-motion`** removes transforms and keeps only instant colour changes. Nothing
  is ever hidden waiting for an animation.

## 4. Screens

**Shell (all signed-in roles)**

- A dark `#182D2B` sidebar on screens 1024 px and wider, containing:
  - the wordmark;
  - the role's navigation, with correct active state, including detail pages;
  - account and sign-out at the bottom.
- Below 1024 px: a light top bar (wordmark, role, avatar, sign-out) with the role's
  destinations as tabs underneath.
  - _Changed in Stage 1:_ no role has more than four destinations, so visible tabs are one tap
    faster than a menu behind a button.
  - The drawer pattern is kept for the landing page, where the links are secondary.
  - It is one navigation landmark at every width (the E2E suite checks this).
- The page header holds the title, one line of description and the primary action ("Report an
  issue" for students). The uppercase eyebrows go.

**Landing**

- **Header:**
  - wordmark;
  - "How it works", "AI and safety", "For campus teams";
  - "Sign in" and the primary "Report an issue";
  - a menu drawer on mobile.
- **Hero:**
  - headline: _"A better way to get campus problems fixed."_;
  - two sentences for students and departments;
  - primary CTA "Report an issue" and secondary "See how it works";
  - a static, pixel-accurate preview of the real ticket page: status badge, timeline and the AI
    routing note.
- **Sections**, each with a different layout:
  1. What you can report: an inline row of the six real categories, with examples.
  2. How it works: one horizontal timeline (report, routed, worked on, confirmed) with the real
     state names.
  3. The product: a framed screenshot-style view of the staff queue next to the admin overview.
  4. AI and safety: a two-column list of the four real guarantees (saved first; AI suggests and
     rules decide; unsure means a person; everything recorded). This is text, not a dark band.
  5. For each role: a three-row comparison of student, staff and admin.
  6. A final CTA with the disclaimer, quiet but readable.
- **Footer:** the accurate prototype statement.

**Student**

- My complaints:
  - a summary strip (open, awaiting your confirmation, closed);
  - search by title, location or `MIR-` number;
  - status filter;
  - a compact list (desktop table, phone rows).
- Report an issue:
  - grouped as _What_ (title, description) and _Where_ (building, room);
  - inline validation and the character count stay;
  - the submit button shows progress;
  - confirmation shows the real reference number and links to the ticket.
  - AI classification appears only once it really exists.
  - No photo upload: not built yet (ADR 0006), so it is not shown.
- Ticket detail:
  - header with reference, status and priority;
  - details panel;
  - description;
  - a full-width chronological timeline;
  - when the ticket is resolved, the confirm and reopen actions are pinned where the student
    reads them.

**Staff**

- **Queue:** a dense table with these columns:
  - reference;
  - title and location;
  - priority (with an attention marker for high);
  - status;
  - age;
  - acknowledged or not.
- **Filters:** Active, Resolved, Closed and All, plus sort (oldest, most urgent, newest).
- **Inspection panel:** on wide screens, selecting a row opens it on the right with the
  description, timeline and actions (Acknowledge, Start work, Work note, Mark resolved). On
  phones the row opens the detail page as today. The URL stays shareable.

**Admin**

- **Overview:** the same real metrics, in a tighter grid:
  - KPI strip;
  - status and age bars;
  - daily reports;
  - department workload table;
  - AI routing outcomes;
  - no decorative charts.
- **Tickets (new page):** every ticket in a table using the existing list API, with search,
  status filter, sort and keyset pagination.
- **Review queue:** the same table component, showing the review reason.
- **Ticket:**
  - two columns, with details, description and history on the left;
  - Route, AI routing and Work note on the right;
  - the history is never buried.
- **Departments:**
  - one table for availability;
  - one compact table for routing, where each row saves on change, with a toast;
  - the change log.

**States everywhere:** skeleton loading that matches the real layout, empty states with one
action, plain-language errors with a retry, and success toasts. All of them are announced to
screen readers.

## 5. One backend addition (additive)

Search needs a database change.

- **The change:** `list_complaints` gains an optional `p_query` parameter in a new migration. It
  matches the title, building, room, or the reference number.
- **Security stays the same:** it remains `SECURITY INVOKER`, so RLS still limits results to what
  the caller may see.
- **Tests:** covered by pgTAP and an API test.
- No other backend change is planned.

## 6. Delivery

Each stage is a branch and PR, merged only when its gate passes.

| Stage | Scope                                                                | Gate (all must pass)                                                                                  |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1     | Tokens, fonts, components, sidebar shell, mobile drawer, toasts      | CI green; axe clean on every page at 390 and 1440; before and after screenshots of every screen       |
| 2     | Landing and authentication                                           | As above, plus 768 and 1366; Lighthouse accessibility 100                                             |
| 3     | Student list with search (migration), report form, ticket detail     | As above, plus new pgTAP and E2E tests for search; idempotent submit still proven                     |
| 4     | Staff table and inspection panel, admin tickets table, admin pages   | As above, plus E2E for the inspection panel and admin table on desktop and Pixel 7                    |
| 5     | Motion pass, reduced motion, keyboard-only walkthrough, final polish | Full suite; keyboard-only run through each role; reduced-motion screenshots; production smoke 27 / 27 |

Each stage ships on its own, so the live site always works, even if we stop mid-way for the expo.
