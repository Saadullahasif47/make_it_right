# ADR 0006: Administrator metrics, configuration and request timing

- **Status:** Accepted
- **Date:** 2026-11-03
- **Phase:** P5

## Context

Plan §7 and §15 (P5.01–P5.08) ask for the following:

- Accurate administrator aggregates: status distribution, ageing and the review backlog.
- A page to manage department availability and default routing rules.
- Endpoint timings in the logs, and visible failures for bad requests.
- A free-quota checklist.

**Gate P5:** the admin sees accurate aggregates, bad requests visibly fail, and media files (if
enabled) are private.

## Decisions

### Metrics

1. **One function computes every number.** `public.admin_metrics(p_window_days)` builds the whole
   dashboard as one jsonb document from one consistent snapshot.
   - It runs as **SECURITY INVOKER**, so the admin's own row-level security still applies, and
     anyone who is not an admin gets `MR403` rather than partial counts.
   - The window is bounded to 1–90 days. The app offers 7, 30 or 90, and anything else falls
     back to 30 on the page or returns 400 from the API.
2. **The app never trusts the payload.** It is validated with a Zod schema before anything
   renders it. The status counts must cover all eight lifecycle states, which the compiler
   checks against the database enum. A malformed payload returns a safe 503.
3. **Charts are server-rendered HTML.** They use one brand hue with direct value labels and no
   client chart library. Every chart is a real list or table, so screen readers get the same
   numbers. Scrollable regions are focusable (a mobile axe run caught this).

### Configuration

4. **Changes go only through two audited functions.** Department availability and routing rules
   change only through `admin_set_department_active` and `admin_set_routing_rule`.
   - They are SECURITY DEFINER and check the admin role from `profiles`.
   - Direct table writes stay denied.
   - "Nothing to change" has its own code, `MR304`, so it is never confused with invalid input.
5. **Every change is logged permanently.** It is appended to `config_changes` with the acting
   admin's id, the entity, and the before and after values.
   - The log is append-only for everyone, including the table owner (trigger).
   - The actor id is stored without a foreign key, so deleting an account can never rewrite
     history.
6. **Deactivating a department is allowed even if rules point to it.** The categories routed
   there then go to the review queue. The AI and the assignment form only use active
   departments, and the admin is told how many rules are affected. Enabling a rule requires an
   active department.

### Operations

7. **Request timing.** Every API route is wrapped in `timed()`, which logs one `http.request`
   line with route, status, request id and duration, and never bodies or complaint text. Server
   errors log at error level. The health check stays unwrapped, because it must work even when
   configuration (which the logger needs) is broken.
8. **Quotas.** `docs/runbooks/free-tier-quotas.md` lists what to check, where, the thresholds
   (watch at 70%, act at 90%), and what users experience when each limit is hit.
9. **Photo evidence (P5.04–P5.05) is deferred.** The plan marks it optional, and it adds storage,
   upload validation and permission-checked downloads. The Gate P5 clause about media is
   therefore vacuous (no media exists). It can be added after the expo with its own migration
   and tests.

## Consequences

- The admin overview now shows the operational picture rather than just account counts.
  Department management moved to `/admin/departments` (new navigation item).
- Each new configuration feature must use an audited function and a `config_changes` entry.
- Integration and E2E tests that change routing restore the original rule, and the E2E test that
  changes a shared rule runs on one browser project only.
