# ADR 0014: Campus heatmap and maintenance insights

- **Status:** Accepted
- **Date:** 2026-11-07
- **Phase:** A6 (Advanced Features add-on, F5 and F6)

## Context

Plan v2 §10 (F5.01–F5.05), §11 (F6.01–F6.06) and phase A6 ask for:

- a floor-plan heatmap of problem density by building and room, with filters, a drilldown and a
  table fallback, for administrators only;
- deterministic recurrence indicators (repeat failures, quick reopenings, building clusters,
  overdue work) with deduplicated, auditable alerts and an insights page;
- counts by distinct case so duplicate reports never inflate anything, with no claim of
  prediction.

**Gate A6:** heatmap counts are explainable and reproducible from database queries; students
cannot browse institutional analytics. An admin can explain why every alert exists; there is no
unsupported claim of failure prediction; insights work with AI disabled.

## Decisions

### Charts without a new dependency

1. **Server-rendered SVG, no Recharts.** The plan's stack table names Recharts. The owner chose
   server-rendered SVG on 2026-11-07, in line with ADR 0006:
   - no new dependency and no client chart JavaScript;
   - charts work without JavaScript, and each has a table carrying the same numbers.

### The numbers (F5.02, F6.02)

2. **Everything is SQL over `maintenance_cases`, counted by distinct case.**
   - A merged case is never counted; its reports count through the case they joined.
   - The heatmap shows the linked report count next to each case count for transparency.
3. **Heatmap colour is a severity-weighted count** (low 1, medium 2, high 3 per case), in five
   steps relative to the busiest room in view. It is a display choice, said so on the page, and
   not a safety score.
4. **Filters:**
   - window: 7, 30 or 90 days (by `opened_at`);
   - building, floor, category, department;
   - status group (all, still open, resolved or closed);
   - whether to include the labelled demo history.

   Malformed filter values fall back to the default; the database refuses anything else (`22023`).
   Cases with no known room are counted separately as "location unknown".

### Rules and alerts (F6.02–F6.04)

5. **Four deterministic rules** with documented demo thresholds:

   | Rule               | Holds when                                                             |
   | ------------------ | ---------------------------------------------------------------------- |
   | `REPEAT_30D`       | 3 or more distinct cases on the same equipment opened in 30 days       |
   | `RECENT_REOPEN`    | a case reopened within 7 days of being resolved, in the last 30 days   |
   | `BUILDING_CLUSTER` | 5 or more distinct cases in one building opened in 30 days             |
   | `LONG_UNRESOLVED`  | an assigned case still being worked on past its category's target days |

   "Past its target" measures from the active work order (A4), else the latest assignment event,
   else the opening. Targets live in `maintenance_sla_policies` (demo defaults: electrical and IT 7
   days, plumbing 3, furniture 14, sanitation 2, other 14). Administrators can edit them on the
   insights page.

6. **Alerts are deduplicated by a partial unique index** (one active alert per rule and subject).
   The refresh:
   - raises an alert for a new hit;
   - for an active alert, refreshes its evidence (cases, window, metric) and counts the check;
   - clears alerts whose rule no longer holds.

   Running it twice raises nothing new.

7. **Audit:** `maintenance_alert_events` (append-only) records raised, acknowledged and cleared,
   with who and an optional note. An acknowledged alert stays listed until its rule stops holding.
8. **Scheduling:** `pg_cron` runs the refresh daily at 02:20. "Refresh now" on the insights page
   runs the same function, and the seed refreshes after creating the demo history.
9. **Every alert links to its evidence:** the distinct cases (with a report to open each), the
   window and the metric behind its sentence. Alerts are worded as indicators with a suggestion
   ("consider a preventive inspection"), never as predictions or probabilities.
10. **No AI explanation layer (F6.05, optional, not built).** The insights are fully deterministic,
    so they trivially work with AI disabled. A cautious summary over the same numbers can be added
    later without changing them.

### Locations and equipment (F5.01, F6.01)

11. **A staff picker sets a case's room and equipment** (`set_case_location`): the department
    holding the case or an administrator, version-checked, with an `updated` case event.
    - Choosing equipment sets its room, and equipment in another room is refused.
    - Codes keep look-alikes apart (PRJ-ENG-203 and PRJ-ENG-204 stay distinct).
    - Reports whose free text cannot be matched (for example "Room 204") stay "location unknown"
      until someone places them.

### Access and the interface (F5.03–F5.04)

12. **Administrators only.** `admin_heatmap`, `admin_heatmap_room`, `admin_maintenance_insights` and
    the alert functions check the role (`MR403`). Alerts and targets have admin-only RLS. No report
    text or reporter names appear in any of them.
13. **Pages and APIs, each behind its own flag:**
    - `/admin/heatmap` (`FEATURE_CAMPUS_HEATMAP`): one SVG plan per building floor; every room is a
      keyboard-reachable link whose accessible name starts with its visible text; the table
      fallback, and the room's cases below the map;
    - `/admin/insights` (`FEATURE_MAINTENANCE_INSIGHTS`): alerts, equipment ranked by cases in 90
      days, weekly distinct cases (SVG with a table), and the targets;
    - `GET /api/admin/heatmap` and `GET /api/admin/maintenance-insights`;
    - nav links shown only while their flag is on.
14. **Flag check after the access check.** The pages read the session first, so they render per
    request and the flag is never frozen into a build-time prerender. Before this change, menu
    navigation hit a cached "not found".

## Consequences

- **Approximate numbers.** The heatmap and insights are only as complete as case locations: an
  unmatched report counts as "location unknown" until staff place it. The cloud's real reports
  (free-text rooms) need this picker before they appear on the map.
- **Demo thresholds.** The thresholds are not calibrated. An editable rule-threshold table is a
  possible extension; for now only the category targets are editable.
- **Daily cadence.** The daily refresh means a new pattern can take up to a day to appear unless
  someone presses "Refresh now".
- **No new secrets.** Deploying needs nothing new; the cron schedule ships with the migration
  (A7).
