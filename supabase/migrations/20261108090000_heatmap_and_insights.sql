-- Campus heatmap and maintenance insights (Advanced Features plan v2 §10-§11, F5.01-F6.06; ADR 0014).
--
--   * Every number is SQL over maintenance_cases, counted by DISTINCT case (never by report), so
--     linked duplicate reports cannot inflate a room, an asset or a building.
--   * Insight rules are deterministic, documented demo thresholds (historical indicators, not
--     predictions). A daily refresh keeps one active alert per rule and subject: it refreshes the
--     evidence, clears what no longer holds and never duplicates.
--   * Everything here is for administrators only; reporters never browse institutional analytics.
--
-- Error codes as elsewhere: MR403 role, MR404 not visible, MR412 stale version, MR422 not
-- allowed now, 22023 invalid input.

-- ---------------------------------------------------------------------------------------------
-- Response-time targets per category (LONG_UNRESOLVED), set by administrators
-- ---------------------------------------------------------------------------------------------
create table public.maintenance_sla_policies (
  category public.complaint_category primary key
    constraint maintenance_sla_policies_classified check (category <> 'unclassified'),
  target_days smallint not null constraint maintenance_sla_policies_days_range check (target_days between 1 and 90),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.maintenance_sla_policies is
  'Days an assigned case may stay unresolved before LONG_UNRESOLVED flags it (demo defaults, admin-editable).';

insert into public.maintenance_sla_policies (category, target_days) values
  ('electrical', 7), ('it_equipment', 7), ('plumbing', 3), ('furniture', 14), ('sanitation', 2), ('other', 14);

-- ---------------------------------------------------------------------------------------------
-- Alerts and their audit trail (F6.03)
-- ---------------------------------------------------------------------------------------------
create type public.alert_status as enum ('open', 'acknowledged', 'cleared');

create table public.maintenance_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null constraint maintenance_alerts_rule
    check (rule_code in ('REPEAT_30D', 'RECENT_REOPEN', 'BUILDING_CLUSTER', 'LONG_UNRESOLVED')),
  -- What the alert is about: 'asset:<id>', 'case:<id>' or 'building:<code>'.
  subject_key text not null constraint maintenance_alerts_subject_format
    check (subject_key ~ '^(asset|case|building):[A-Za-z0-9-]{2,40}$'),
  asset_id uuid references public.asset_registry (id) on delete set null,
  location_id uuid references public.maintenance_locations (id) on delete set null,
  building_code text,
  level text not null constraint maintenance_alerts_level check (level in ('notice', 'warning')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  -- The distinct cases behind the alert: every number links back to them (F6.04).
  case_ids uuid[] not null constraint maintenance_alerts_has_cases check (cardinality(case_ids) >= 1),
  metric jsonb not null default '{}'::jsonb constraint maintenance_alerts_metric_object check (jsonb_typeof(metric) = 'object'),
  status public.alert_status not null default 'open',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  refresh_count integer not null default 1,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_at timestamptz,
  acknowledgement_note text constraint maintenance_alerts_note_length
    check (acknowledgement_note is null or char_length(acknowledgement_note) between 1 and 500),
  cleared_at timestamptz,
  constraint maintenance_alerts_window check (window_end >= window_start),
  constraint maintenance_alerts_acknowledged check (status <> 'acknowledged' or acknowledged_at is not null),
  constraint maintenance_alerts_cleared check ((status = 'cleared') = (cleared_at is not null))
);

comment on table public.maintenance_alerts is
  'Historical maintenance indicators (plan v2 F6). Deterministic rules over distinct cases; not predictions.';

-- Deduplication: one active alert per rule and subject, however often the refresh runs.
create unique index maintenance_alerts_one_active on public.maintenance_alerts (rule_code, subject_key)
  where status in ('open', 'acknowledged');
create index maintenance_alerts_status_idx on public.maintenance_alerts (status, window_end desc);

create table public.maintenance_alert_events (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.maintenance_alerts (id) on delete cascade,
  event_type text not null constraint maintenance_alert_events_type
    check (event_type in ('raised', 'acknowledged', 'cleared')),
  actor_id uuid references public.profiles (id) on delete set null,
  note text constraint maintenance_alert_events_note_length check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index maintenance_alert_events_alert_idx on public.maintenance_alert_events (alert_id, created_at);

create trigger maintenance_alert_events_append_only
  before update on public.maintenance_alert_events
  for each row execute function private.reject_history_update();

-- Supports the time-window aggregations below.
create index maintenance_cases_opened_idx on public.maintenance_cases (opened_at desc) where status <> 'merged';

alter table public.maintenance_sla_policies enable row level security;
alter table public.maintenance_alerts enable row level security;
alter table public.maintenance_alert_events enable row level security;
revoke all on table public.maintenance_sla_policies, public.maintenance_alerts, public.maintenance_alert_events
  from anon, authenticated;
grant select on table public.maintenance_sla_policies, public.maintenance_alerts, public.maintenance_alert_events
  to authenticated;

create policy maintenance_sla_policies_select_admin
  on public.maintenance_sla_policies for select to authenticated
  using ((select private.current_app_role()) = 'admin');
create policy maintenance_alerts_select_admin
  on public.maintenance_alerts for select to authenticated
  using ((select private.current_app_role()) = 'admin');
create policy maintenance_alert_events_select_admin
  on public.maintenance_alert_events for select to authenticated
  using ((select private.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------
-- The rules (F6.02): what holds now, from the case history
-- ---------------------------------------------------------------------------------------------
create function private.maintenance_rule_hits()
returns table (
  rule_code text,
  subject_key text,
  asset_id uuid,
  location_id uuid,
  building_code text,
  level text,
  window_start timestamptz,
  window_end timestamptz,
  case_ids uuid[],
  metric jsonb
)
language sql
stable
set search_path = ''
as $$
  -- REPEAT_30D: three or more distinct cases on the same equipment opened in 30 days.
  select 'REPEAT_30D', 'asset:' || a.id, a.id, a.location_id, l.building_code, 'warning',
         now() - interval '30 days', now(),
         array_agg(mc.id order by mc.opened_at),
         jsonb_build_object('cases', count(*), 'asset_code', a.asset_code)
    from public.maintenance_cases as mc
    join public.asset_registry as a on a.id = mc.asset_id
    join public.maintenance_locations as l on l.id = a.location_id
   where mc.status <> 'merged' and mc.opened_at > now() - interval '30 days'
   group by a.id, a.location_id, l.building_code, a.asset_code
  having count(*) >= 3

  union all
  -- RECENT_REOPEN: a case reopened within 7 days of being resolved, in the last 30 days (its
  -- latest such reopening).
  (select distinct on (mc.id)
         'RECENT_REOPEN', 'case:' || mc.id, mc.asset_id, mc.location_id, l.building_code, 'notice',
         resolved.created_at, reopened.created_at,
         array[mc.id],
         jsonb_build_object('resolved_at', resolved.created_at, 'reopened_at', reopened.created_at,
                            'gap_days', round(extract(epoch from reopened.created_at - resolved.created_at) / 86400.0, 1))
    from public.case_events as reopened
    join public.maintenance_cases as mc on mc.id = reopened.case_id
    left join public.maintenance_locations as l on l.id = mc.location_id
    join lateral (
      select e.created_at from public.case_events as e
       where e.case_id = reopened.case_id and e.new_status = 'resolved' and e.created_at <= reopened.created_at
       order by e.created_at desc
       limit 1
    ) as resolved on true
   where reopened.new_status = 'reopened'
     and reopened.created_at > now() - interval '30 days'
     and reopened.created_at - resolved.created_at <= interval '7 days'
     and mc.status <> 'merged'
   order by mc.id, reopened.created_at desc)

  union all
  -- BUILDING_CLUSTER: five or more distinct cases in one building opened in 30 days.
  select 'BUILDING_CLUSTER', 'building:' || l.building_code, null, null, l.building_code, 'notice',
         now() - interval '30 days', now(),
         array_agg(mc.id order by mc.opened_at),
         jsonb_build_object('cases', count(*), 'building_name', min(l.building_name))
    from public.maintenance_cases as mc
    join public.maintenance_locations as l on l.id = mc.location_id
   where mc.status <> 'merged' and mc.opened_at > now() - interval '30 days'
   group by l.building_code
  having count(*) >= 5

  union all
  -- LONG_UNRESOLVED: an assigned case still being worked on past its category's target.
  select 'LONG_UNRESOLVED', 'case:' || c.id, c.asset_id, c.location_id, l.building_code, 'warning',
         c.since, now(),
         array[c.id],
         jsonb_build_object('category', c.category, 'target_days', p.target_days,
                            'age_days', round(extract(epoch from now() - c.since) / 86400.0, 1))
    from (
      select mc.*, coalesce(
               (select w.assigned_at from public.case_work_orders as w where w.case_id = mc.id and w.status = 'active'),
               (select max(e.created_at) from public.case_events as e where e.case_id = mc.id and e.event_type = 'assigned'),
               mc.opened_at) as since
        from public.maintenance_cases as mc
       where mc.status in ('assigned', 'in_progress', 'reopened') and mc.assigned_department_id is not null
    ) as c
    join public.maintenance_sla_policies as p on p.category = c.category
    left join public.maintenance_locations as l on l.id = c.location_id
   where c.since < now() - make_interval(days => p.target_days);
$$;

revoke all on function private.maintenance_rule_hits() from public, anon, authenticated;

-- The daily refresh (F6.03): raise new alerts, refresh active ones, clear those that no longer
-- hold. One active alert per rule and subject; running it twice changes nothing new.
create function private.refresh_maintenance_alerts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hit record;
  v_alert uuid;
  v_raised integer := 0;
  v_refreshed integer := 0;
  v_cleared integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('maintenance_alerts_refresh', 0));
  create temporary table if not exists pg_temp.current_hits on commit drop as
    select * from private.maintenance_rule_hits() with no data;
  truncate pg_temp.current_hits;
  insert into pg_temp.current_hits select * from private.maintenance_rule_hits();

  for v_hit in select * from pg_temp.current_hits loop
    update public.maintenance_alerts as a
       set case_ids = v_hit.case_ids, metric = v_hit.metric, window_start = v_hit.window_start,
           window_end = v_hit.window_end, last_seen_at = now(), refresh_count = a.refresh_count + 1
     where a.rule_code = v_hit.rule_code and a.subject_key = v_hit.subject_key and a.status in ('open', 'acknowledged')
    returning a.id into v_alert;
    if v_alert is null then
      insert into public.maintenance_alerts
        (rule_code, subject_key, asset_id, location_id, building_code, level, window_start, window_end, case_ids, metric)
      values (v_hit.rule_code, v_hit.subject_key, v_hit.asset_id, v_hit.location_id, v_hit.building_code, v_hit.level,
              v_hit.window_start, v_hit.window_end, v_hit.case_ids, v_hit.metric)
      returning id into v_alert;
      insert into public.maintenance_alert_events (alert_id, event_type) values (v_alert, 'raised');
      v_raised := v_raised + 1;
    else
      v_refreshed := v_refreshed + 1;
    end if;
    v_alert := null;
  end loop;

  for v_alert in
    update public.maintenance_alerts as a set status = 'cleared', cleared_at = now()
     where a.status in ('open', 'acknowledged')
       and not exists (select 1 from pg_temp.current_hits as h
                        where h.rule_code = a.rule_code and h.subject_key = a.subject_key)
    returning a.id
  loop
    insert into public.maintenance_alert_events (alert_id, event_type, note)
    values (v_alert, 'cleared', 'The rule no longer holds.');
    v_cleared := v_cleared + 1;
  end loop;

  return jsonb_build_object('raised', v_raised, 'refreshed', v_refreshed, 'cleared', v_cleared);
end;
$$;

revoke all on function private.refresh_maintenance_alerts() from public, anon, authenticated;

select cron.schedule('makeitright-insights-refresh', '20 2 * * *', 'select private.refresh_maintenance_alerts()');

-- ---------------------------------------------------------------------------------------------
-- Administrator functions
-- ---------------------------------------------------------------------------------------------
create function private.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'admins only' using errcode = 'MR403';
  end if;
end;
$$;

revoke all on function private.require_admin() from public, anon, authenticated;

-- The cases a heatmap view covers (F5.02): filters by window, place, category, department and
-- status group; merged cases are counted through the case they joined.
create function private.heatmap_cases(
  p_days integer,
  p_building text,
  p_floor smallint,
  p_category public.complaint_category,
  p_department uuid,
  p_status text,
  p_include_synthetic boolean
)
returns setof public.maintenance_cases
language sql
stable
set search_path = ''
as $$
  select mc.*
    from public.maintenance_cases as mc
    left join public.maintenance_locations as l on l.id = mc.location_id
   where mc.status <> 'merged'
     and mc.opened_at > now() - make_interval(days => p_days)
     and (p_building is null or l.building_code = p_building)
     and (p_floor is null or l.floor = p_floor)
     and (p_category is null or mc.category = p_category)
     and (p_department is null or mc.assigned_department_id = p_department)
     and (p_include_synthetic or not mc.is_synthetic)
     and case p_status
           when 'active' then mc.status in ('open', 'needs_review', 'assigned', 'in_progress', 'reopened')
           when 'done' then mc.status in ('resolved', 'closed')
           else true
         end;
$$;

revoke all on function private.heatmap_cases(integer, text, smallint, public.complaint_category, uuid, text, boolean)
  from public, anon, authenticated;

-- GET /api/admin/heatmap (plan §12): every room with its distinct cases, linked reports and a
-- severity-weighted count (a display choice: low 1, medium 2, high 3; not a safety score).
create function public.admin_heatmap(
  p_days integer default 30,
  p_building text default null,
  p_floor smallint default null,
  p_category public.complaint_category default null,
  p_department uuid default null,
  p_status text default 'all',
  p_include_synthetic boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'the window is 7, 30 or 90 days' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('all', 'active', 'done') then
    raise exception 'unknown status filter' using errcode = '22023';
  end if;

  return (
    with cases as (
      select c.*, (select count(*) from public.case_reports as cr where cr.case_id = c.id) as reports
        from private.heatmap_cases(p_days, p_building, p_floor, p_category, p_department, p_status, p_include_synthetic) as c
    ),
    rooms as (
      select l.id, l.building_code, l.building_name, l.floor, l.room_code, l.display_name, l.map_x, l.map_y,
             count(c.id) as cases,
             coalesce(sum(c.reports), 0) as reports,
             coalesce(sum(case c.priority when 'high' then 3 when 'medium' then 2 else 1 end) filter (where c.id is not null), 0) as weighted,
             count(c.id) filter (where c.status in ('open', 'needs_review', 'assigned', 'in_progress', 'reopened')) as active
        from public.maintenance_locations as l
        left join cases as c on c.location_id = l.id
       where l.is_active
         and (p_building is null or l.building_code = p_building)
         and (p_floor is null or l.floor = p_floor)
       group by l.id
    )
    select jsonb_build_object(
      'window_days', p_days,
      'generated_at', now(),
      'rooms', coalesce((select jsonb_agg(jsonb_build_object(
          'location_id', r.id, 'building_code', r.building_code, 'building_name', r.building_name,
          'floor', r.floor, 'room_code', r.room_code, 'display_name', r.display_name,
          'map_x', r.map_x, 'map_y', r.map_y, 'cases', r.cases, 'reports', r.reports,
          'weighted', r.weighted, 'active', r.active)
        order by r.building_code, r.floor, r.room_code) from rooms as r), '[]'::jsonb),
      'unknown', (select jsonb_build_object('cases', count(*), 'reports', coalesce(sum(c.reports), 0))
                    from cases as c where c.location_id is null),
      'totals', (select jsonb_build_object('cases', count(*), 'reports', coalesce(sum(c.reports), 0),
                                           'synthetic_cases', count(*) filter (where c.is_synthetic))
                   from cases as c)
    )
  );
end;
$$;

-- The cases behind one room on the heatmap (drilldown, F5.04), with a report to open each one.
create function public.admin_heatmap_room(
  p_location_id uuid,
  p_days integer default 30,
  p_category public.complaint_category default null,
  p_department uuid default null,
  p_status text default 'all',
  p_include_synthetic boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_days is null or p_days not in (7, 30, 90) or p_status not in ('all', 'active', 'done') then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'case_id', c.id, 'reference', 'MC-' || c.reference_no, 'category', c.category,
             'priority', c.priority, 'status', c.status, 'opened_at', c.opened_at, 'synthetic', c.is_synthetic,
             'asset_code', (select a.asset_code from public.asset_registry as a where a.id = c.asset_id),
             'reports', (select count(*) from public.case_reports as cr where cr.case_id = c.id),
             'complaint_id', (select cr.complaint_id from public.case_reports as cr where cr.case_id = c.id
                               order by cr.linked_at limit 1))
           order by c.opened_at desc)
      from private.heatmap_cases(p_days, null, null, p_category, p_department, p_status, p_include_synthetic) as c
     where c.location_id = p_location_id), '[]'::jsonb);
end;
$$;

-- GET /api/admin/maintenance-insights (plan §12): alerts with their evidence, equipment ranked
-- by distinct cases in 90 days, weekly distinct cases and the response-time targets.
create function public.admin_maintenance_insights(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_weeks is null or p_weeks not between 4 and 26 then
    raise exception 'weeks must be between 4 and 26' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'rule_code', a.rule_code, 'level', a.level, 'status', a.status,
               'window_start', a.window_start, 'window_end', a.window_end, 'metric', a.metric,
               'first_seen_at', a.first_seen_at, 'last_seen_at', a.last_seen_at, 'refresh_count', a.refresh_count,
               'acknowledged_at', a.acknowledged_at, 'acknowledgement_note', a.acknowledgement_note,
               'building_code', a.building_code,
               'asset', (select jsonb_build_object('code', x.asset_code, 'label', x.label)
                           from public.asset_registry as x where x.id = a.asset_id),
               'location', (select l.display_name from public.maintenance_locations as l where l.id = a.location_id),
               'cases', (select jsonb_agg(jsonb_build_object(
                                  'case_id', mc.id, 'reference', 'MC-' || mc.reference_no, 'status', mc.status,
                                  'opened_at', mc.opened_at, 'synthetic', mc.is_synthetic,
                                  'complaint_id', (select cr.complaint_id from public.case_reports as cr
                                                    where cr.case_id = mc.id order by cr.linked_at limit 1))
                                order by mc.opened_at)
                           from public.maintenance_cases as mc where mc.id = any (a.case_ids)))
             order by case a.level when 'warning' then 0 else 1 end, a.first_seen_at)
        from public.maintenance_alerts as a
       where a.status in ('open', 'acknowledged')), '[]'::jsonb),
    'ranked_assets', coalesce((
      select jsonb_agg(r order by r.cases desc, r.code)
        from (
          select x.id as asset_id, x.asset_code as code, x.label, l.display_name as location,
                 count(mc.id) as cases, max(mc.opened_at) as latest
            from public.asset_registry as x
            join public.maintenance_locations as l on l.id = x.location_id
            join public.maintenance_cases as mc on mc.asset_id = x.id
           where mc.status <> 'merged' and mc.opened_at > now() - interval '90 days'
           group by x.id, l.display_name
           order by count(mc.id) desc, x.asset_code
           limit 10
        ) as r), '[]'::jsonb),
    'trend', (
      select jsonb_agg(jsonb_build_object('week_start', w.week_start,
               'cases', (select count(*) from public.maintenance_cases as mc
                          where mc.status <> 'merged' and mc.opened_at >= w.week_start
                            and mc.opened_at < w.week_start + interval '7 days'))
             order by w.week_start)
        from (select date_trunc('week', now()) - make_interval(weeks => g) as week_start
                from generate_series(0, p_weeks - 1) as g) as w),
    'sla', (select jsonb_agg(jsonb_build_object('category', p.category, 'target_days', p.target_days) order by p.category)
              from public.maintenance_sla_policies as p)
  );
end;
$$;

-- An administrator acknowledges an alert: it stays visible until its rule stops holding.
create function public.admin_acknowledge_alert(p_alert_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  perform private.require_admin();
  update public.maintenance_alerts as a
     set status = 'acknowledged', acknowledged_by = (select auth.uid()), acknowledged_at = now(),
         acknowledgement_note = left(v_note, 500)
   where a.id = p_alert_id and a.status = 'open';
  if not found then
    if not exists (select 1 from public.maintenance_alerts as a where a.id = p_alert_id) then
      raise exception 'alert not found' using errcode = 'MR404';
    end if;
    raise exception 'the alert is not open' using errcode = 'MR422';
  end if;
  insert into public.maintenance_alert_events (alert_id, event_type, actor_id, note)
  values (p_alert_id, 'acknowledged', (select auth.uid()), left(v_note, 500));
end;
$$;

-- "Refresh now": the same function the daily job runs.
create function public.admin_refresh_alerts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.refresh_maintenance_alerts();
end;
$$;

create function public.admin_set_category_sla(p_category public.complaint_category, p_target_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_target_days is null or p_target_days not between 1 and 90 then
    raise exception 'between 1 and 90 days' using errcode = '22023';
  end if;
  update public.maintenance_sla_policies as p
     set target_days = p_target_days, updated_by = (select auth.uid()), updated_at = now()
   where p.category = p_category;
  if not found then
    raise exception 'unknown category' using errcode = 'MR404';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Room and equipment of a case (F5.01, F6.01): staff fix what the report's text could not tell
-- ---------------------------------------------------------------------------------------------
create function public.set_case_location(
  p_case_id uuid,
  p_expected_version integer,
  p_location_id uuid default null,
  p_asset_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := (select private.current_app_role());
  v_case public.maintenance_cases;
  v_location uuid := p_location_id;
  v_asset public.asset_registry;
  v_label text;
begin
  if v_role is distinct from 'admin' and v_role is distinct from 'department' then
    raise exception 'staff only' using errcode = 'MR403';
  end if;
  select mc.* into v_case from public.maintenance_cases as mc where mc.id = p_case_id for update;
  if not found or v_case.is_synthetic
     or (v_role = 'department' and v_case.assigned_department_id is distinct from (select private.current_department_id())) then
    raise exception 'case not found' using errcode = 'MR404';
  end if;
  if v_case.status in ('closed', 'merged') then
    raise exception 'the case is no longer open' using errcode = 'MR422';
  end if;
  if v_case.version is distinct from p_expected_version then
    raise exception 'the case changed' using errcode = 'MR412';
  end if;

  if p_asset_id is not null then
    select x.* into v_asset from public.asset_registry as x where x.id = p_asset_id and x.is_active;
    if not found then
      raise exception 'unknown equipment' using errcode = '22023';
    end if;
    -- Equipment belongs to one room: choosing it sets the room.
    if v_location is not null and v_location <> v_asset.location_id then
      raise exception 'that equipment is in another room' using errcode = '22023';
    end if;
    v_location := v_asset.location_id;
  end if;
  if v_location is not null
     and not exists (select 1 from public.maintenance_locations as l where l.id = v_location and l.is_active) then
    raise exception 'unknown room' using errcode = '22023';
  end if;

  update public.maintenance_cases as mc
     set location_id = v_location, asset_id = p_asset_id, version = mc.version + 1
   where mc.id = v_case.id;

  select coalesce(l.display_name, 'unknown') || coalesce(' / ' || v_asset.asset_code, '') into v_label
    from (select 1) as one left join public.maintenance_locations as l on l.id = v_location;
  insert into public.case_events (case_id, event_type, actor_id, actor_kind, note)
  values (v_case.id, 'updated', (select auth.uid()), 'user', left('Location set to ' || v_label || '.', 1000));
  return v_case.version + 1;
end;
$$;

revoke all on function public.admin_heatmap(integer, text, smallint, public.complaint_category, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.admin_heatmap_room(uuid, integer, public.complaint_category, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.admin_maintenance_insights(integer) from public, anon, authenticated;
revoke all on function public.admin_acknowledge_alert(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_refresh_alerts() from public, anon, authenticated;
revoke all on function public.admin_set_category_sla(public.complaint_category, integer) from public, anon, authenticated;
revoke all on function public.set_case_location(uuid, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_heatmap(integer, text, smallint, public.complaint_category, uuid, text, boolean)
  to authenticated;
grant execute on function public.admin_heatmap_room(uuid, integer, public.complaint_category, uuid, text, boolean)
  to authenticated;
grant execute on function public.admin_maintenance_insights(integer) to authenticated;
grant execute on function public.admin_acknowledge_alert(uuid, text) to authenticated;
grant execute on function public.admin_refresh_alerts() to authenticated;
grant execute on function public.admin_set_category_sla(public.complaint_category, integer) to authenticated;
grant execute on function public.set_case_location(uuid, integer, uuid, uuid) to authenticated;

-- The seeded history has known recurring issues (F6.06): raise their alerts now.
select private.refresh_maintenance_alerts();
