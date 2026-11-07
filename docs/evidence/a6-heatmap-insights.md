# Evidence: Add-on phase A6, F5 campus heatmap and F6 maintenance insights

**Gate A6 (plan v2 §14, §10, §11):** heatmap counts are explainable and reproducible from
database queries; students cannot browse institutional analytics. An admin can explain why every
alert exists; there is no unsupported claim of failure prediction; insights work with AI disabled.

Design decisions: [ADR 0014](../adr/0014-heatmap-and-insights.md).

## Task checklist

| ID    | Task                                                            | Status | Evidence                                                                                                   |
| ----- | --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| A6.01 | Normalised buildings and rooms; SVG floor plan; SQL aggregation | Done   | A0's 36 rooms; `admin_heatmap` (distinct cases, linked reports, weighted count); one SVG plan per floor    |
| A6.02 | Filters, drilldowns, table fallback                             | Done   | Window, building, floor, category, department, status, demo history; `admin_heatmap_room`; the rooms table |
| A6.03 | Historical repeat-failure and overdue work-order rules          | Done   | `REPEAT_30D`, `RECENT_REOPEN`, `BUILDING_CLUSTER`, `LONG_UNRESOLVED` with admin-editable targets           |
| A6.04 | Alerts, deduplication, evidence links, insights dashboard       | Done   | `maintenance_alerts` (one active per rule and subject), event audit, daily cron, `/admin/insights`         |

Also covered:

- **F5.01:** unmatched reports are counted as "location unknown"; a staff picker places them.
- **F5.03:** keyboard-reachable hotspots and a table fallback.
- **F5.05:** empty building, no location, duplicate reports, role isolation, 30-day cutoff.
- **F6.01:** the equipment picker keeps look-alikes distinct.
- **F6.06:** backtest on the seeded history.
- **§12:** `GET /api/admin/heatmap` and `GET /api/admin/maintenance-insights`.

**Not built:** F6.05, the optional AI explanation layer (ADR 0014 §10). Insights are fully
deterministic.

## Verify clauses, as tested

| Plan clause                                                                    | How it was shown                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counts come from unique cases, not reports (A6.01, F5.02)                      | pgTAP: two reports linked into one case show 1 case and 2 reports in their room; merged cases are never counted                                                                                             |
| Verified against SQL count fixtures (A6.02)                                    | pgTAP fixtures: an empty room shows 0; a building filter keeps all 12 rooms; an unknown room adds to "location unknown"; the drilldown lists exactly the room's cases                                       |
| Every new case has a known location or is UNKNOWN (F5.01)                      | pgTAP and integration: text that matches ("ENG" / "Engineering Block", "LAB-203") is placed; free text is counted as unknown until the picker places it                                                     |
| Screen reader and keyboard users can navigate hotspots (F5.03)                 | E2E: a hotspot takes focus and Enter opens its cases; axe finds no violations (including "label in name"); the same data is in a table                                                                      |
| Counts change after a real case updates (F5.04)                                | Integration: a new report raises its room by one; moving the case with the picker moves the count                                                                                                           |
| Empty building, no location, duplicates, role isolation, 30-day cutoff (F5.05) | pgTAP: each one, including a case opened 40 days ago being outside 30 days and inside 90. Integration and E2E: students and departments get `MR403` / 403 and see no alerts                                 |
| Two similarly named projectors remain distinct (F6.01)                         | pgTAP: choosing PRJ-ENG-203 stores that exact asset and its room; PRJ-ENG-204's alert is unaffected                                                                                                         |
| History queries produce deterministic counts from seed data (F6.02)            | pgTAP backtest (below)                                                                                                                                                                                      |
| Daily refresh does not create duplicate alerts (F6.03, A6.04)                  | pgTAP: a second refresh raises 0, keeps the same active alerts and counts one more check; a second active alert for the same rule and subject is a unique violation. Integration: same through the real API |
| Every score links to cases and a date window (F6.04)                           | Integration: every alert carries its cases. E2E: an alert lists its 3 evidence cases as links with the window                                                                                               |
| No predictive probability without measured data (A6.03, gate)                  | Unit: no rule wording mentions prediction, probability or percentages. Both pages say "indicators, not a trained prediction"                                                                                |
| An admin can explain why every alert exists (gate)                             | Each alert shows its rule, window, metric sentence and cases; the event history records raised, acknowledged and cleared (pgTAP)                                                                            |

## Backtest on the seeded history (F6.06, synthetic scenario evaluation)

The A0 demo history (60 labelled synthetic cases) has known recurring issues and look-alike
near misses. After the seed's refresh:

| Scenario in the seed                                                     | Expected         | Flagged |
| ------------------------------------------------------------------------ | ---------------- | ------- |
| Projector PRJ-ENG-204: 3 cases in 26 days                                | REPEAT_30D       | yes     |
| Projector PRJ-ENG-203 next door: 1 case                                  | nothing          | nothing |
| Engineering Block: 6 cases in 30 days                                    | BUILDING_CLUSTER | yes     |
| Science (3 cases) and Library (2 cases)                                  | nothing          | nothing |
| Sink SNK-SCI-205: reopened 3 days after its repair                       | RECENT_REOPEN    | yes     |
| The same sink, reopened and unresolved for 11.9 days (plumbing target 3) | LONG_UNRESOLVED  | yes     |
| AC unit ACU-LIB-101: assigned about 21 days ago (target 7)               | LONG_UNRESOLVED  | yes     |
| Projector PRJ-ENG-204's open case: 3.9 days (target 7)                   | nothing          | nothing |

5 of 5 flags are the intended scenarios, and 0 of the 4 near misses were flagged, on this
synthetic set. This is a check of the rules' logic against designed scenarios, not an estimate of
real-world precision.

## Screenshots (local preview; all add-on features on)

| View                                                                                | File                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Heatmap (desktop, 90 days): filters, legend, floor plans                            | [heatmap-desktop.jpg](a6/heatmap-desktop.jpg)               |
| Heatmap (phone): Engineering floor 2 with LAB-204 selected, and the rooms table     | [heatmap-mobile-floor.jpg](a6/heatmap-mobile-floor.jpg)     |
| Heatmap (phone): LAB-204's cases (drilldown)                                        | [heatmap-mobile-room.jpg](a6/heatmap-mobile-room.jpg)       |
| Insights: alerts with rule, window, evidence and Acknowledge                        | [insights-alerts.jpg](a6/insights-alerts.jpg)               |
| Insights: equipment ranked by cases, and cases per week                             | [insights-ranking-trend.jpg](a6/insights-ranking-trend.jpg) |
| Ticket page: "Room and equipment" for a report whose room text could not be matched | [ticket-location-picker.jpg](a6/ticket-location-picker.jpg) |

The preview led to these fixes:

- **Weekly chart:** the tallest bars' numbers were cut off and the labels were too small. The chart
  is now drawn near its display size with headroom, and the last date is right-aligned.
- **Summary wording:** "12 cases from 0 reports" now explains that demo cases have no reports.
- **Phone filters:** they take two columns instead of seven full-width rows.
- **Room labels:** they have a halo, so they stay readable on the darkest fill in either theme.

The console had no errors, and the phone layout had no horizontal overflow.

## Local verification

Run on 2026-11-07 on `phase/a6-heatmap-insights` after `supabase db reset`. The first E2E
server has every flag OFF; the second has every add-on feature from A1 to A6 on.

| Suite                        | Result                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`                  | Pass, 0 warnings                                                               |
| `pnpm typecheck` (tsc)       | Pass                                                                           |
| `pnpm format:check`          | Pass                                                                           |
| `pnpm test` (unit + DOM)     | **584 / 584** (8 new: filters, links, colour steps, alert wording, navigation) |
| `pnpm db:test` (pgTAP)       | **573 / 573** in 14 files (39 new in `014_heatmap_and_insights`)               |
| `pnpm test:integration`      | **151 / 151** (3 new: live counts, role isolation, deduplicated alerts)        |
| `pnpm build`                 | Pass                                                                           |
| `pnpm test:e2e` (Playwright) | **233 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed     |

New E2E journeys (`heatmap-insights.spec.ts`), on desktop Chromium and Pixel 7:

- an administrator opens the heatmap from the menu, moves to a room with the keyboard, opens its
  cases and widens the window (axe clean);
- an administrator places a case on its equipment with the ticket page's picker, refreshes the
  rules and acknowledges the resulting alert; the JSON API returns it as acknowledged (axe clean);
- a student sees no link, gets the 403 page and 403 from both APIs;
- with both flags OFF there is no link, both pages are 404, and both APIs answer 404.

The spec passed 16/16 when repeated twice. Each run creates its own throwaway equipment, so
parallel and repeated runs never share an alert.

**Mutation check.** Counting merged cases (removing the `status <> 'merged'` filter) fails four
pgTAP tests, including "two reports of one problem count as one case". Restored afterwards.

**Found while testing, fixed before the gate:**

- Opening the heatmap from the menu showed "page not found". The flag check ran before anything
  per-request, so Next prerendered a frozen 404 for client navigation. The pages now check access
  first, as the AI jobs page does.
- The SVG hotspots failed axe's "label in name": their names did not start with the visible text.
  The room code and count are now one text with a space, and each name starts with them.
- The repeated E2E run shared equipment between parallel copies; it now uses throwaway equipment.

**Not verified here:** the cloud. The migration (including the daily cron job) and the flags are
not pushed; that is A7 with the owner's approval. Real cloud reports with free-text rooms will
show as "location unknown" until placed with the picker.
