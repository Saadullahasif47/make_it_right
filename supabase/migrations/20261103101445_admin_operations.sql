-- MakeItRight: administrator operations (master plan P5.01, P5.06; §7 /admin and /admin/departments).
--
--   * admin_metrics() computes every dashboard number in one SECURITY INVOKER query, so the
--     admin's own RLS policies still apply; anyone else is refused (MR403) rather than handed
--     partial counts.
--   * Department availability and default routing rules change only through two audited,
--     admin-only functions. Every change is appended to config_changes, which nobody can edit.
--
-- Error codes: MR403 not an administrator   MR404 department not found   22023 invalid input
--              MR304 nothing to change (the requested setting is already in place)

-- ---------------------------------------------------------------------------------------------
-- Configuration change log
-- ---------------------------------------------------------------------------------------------
create table public.config_changes (
  id bigint generated always as identity primary key,
  -- The acting administrator's id, kept as plain data (no foreign key) so history survives
  -- account removal and can never be rewritten by a cascade.
  changed_by uuid not null,
  entity text not null constraint config_changes_entity check (entity in ('department', 'routing_rule')),
  entity_key text not null constraint config_changes_key_length check (char_length(entity_key) between 1 and 100),
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.config_changes is 'Append-only audit of department and routing changes (P5).';

create index config_changes_recent on public.config_changes (created_at desc);

create function private.reject_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '42501', hint = 'Record a new change instead of editing history.';
end;
$$;

revoke all on function private.reject_history_change() from public, anon, authenticated;

create trigger config_changes_append_only
  before update or delete on public.config_changes
  for each row execute function private.reject_history_change();

alter table public.config_changes enable row level security;
revoke all on table public.config_changes from anon, authenticated;
grant select on table public.config_changes to authenticated;

create policy config_changes_select_admin
  on public.config_changes for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------
-- admin_metrics: everything the dashboard shows, from one consistent snapshot
-- ---------------------------------------------------------------------------------------------
create function public.admin_metrics(p_window_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_today date := (now() at time zone 'utc')::date;
  v_result jsonb;
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'only administrators can read metrics' using errcode = 'MR403';
  end if;
  if p_window_days is null or p_window_days not between 1 and 90 then
    raise exception 'the window must be 1 to 90 days' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_window_days);

  with
  open_tickets as (
    select c.id, now() - c.created_at as age
      from public.complaints as c
     where c.status in ('submitted', 'triaging', 'needs_review', 'assigned', 'in_progress', 'reopened')
  ),
  first_resolved as (
    select e.complaint_id, min(e.created_at) as resolved_at
      from public.ticket_events as e
     where e.new_status = 'resolved'
     group by e.complaint_id
  ),
  resolved_in_window as (
    select r.complaint_id, r.resolved_at - c.created_at as time_to_resolve, c.assigned_department_id
      from first_resolved as r
      join public.complaints as c on c.id = r.complaint_id
     where r.resolved_at >= v_since
  ),
  window_runs as (
    select r.outcome, r.failure_code, r.duration_ms
      from public.agent_runs as r
     where r.started_at >= v_since
  ),
  department_rows as (
    select d.name,
           jsonb_build_object(
             'id', d.id,
             'name', d.name,
             'is_active', d.is_active,
             'open', count(c.id) filter (where c.status in ('assigned', 'in_progress', 'reopened')),
             'unacknowledged', count(c.id) filter (where c.status in ('assigned', 'reopened') and c.acknowledged_at is null),
             'in_progress', count(c.id) filter (where c.status = 'in_progress'),
             'resolved_in_window', (select count(*) from resolved_in_window as w where w.assigned_department_id = d.id)
           ) as row_json
      from public.departments as d
      left join public.complaints as c on c.assigned_department_id = d.id
     group by d.id, d.name, d.is_active
  ),
  days as (
    select (v_today - g)::date as day from generate_series(0, 13) as g
  ),
  created_by_day as (
    select (c.created_at at time zone 'utc')::date as day, count(*) as n
      from public.complaints as c
     where c.created_at >= (v_today - 13)::timestamp at time zone 'utc'
     group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', p_window_days,
    'totals', jsonb_build_object(
      'all', (select count(*) from public.complaints),
      'open', (select count(*) from open_tickets),
      'created_in_window', (select count(*) from public.complaints as c where c.created_at >= v_since),
      'closed_in_window', (select count(distinct e.complaint_id) from public.ticket_events as e
                            where e.new_status = 'closed' and e.created_at >= v_since)
    ),
    'status_counts', (
      select jsonb_object_agg(s.state::text, coalesce(n.count, 0))
        from unnest(enum_range(null::public.ticket_state)) as s(state)
        left join (select c.status, count(*) as count from public.complaints as c group by c.status) as n
          on n.status = s.state
    ),
    'routing', jsonb_build_object(
      'awaiting', (select count(*) from public.complaints as c where c.status in ('submitted', 'triaging', 'needs_review')),
      'needs_review', (select count(*) from public.complaints as c where c.status = 'needs_review'),
      'stalled_triage', (select count(*) from public.complaints as c
                          where c.status = 'triaging' and c.updated_at < now() - interval '2 minutes')
    ),
    'aging', (
      select jsonb_build_object(
        'under_1_day', count(*) filter (where o.age < interval '1 day'),
        'one_to_3_days', count(*) filter (where o.age >= interval '1 day' and o.age < interval '3 days'),
        'three_to_7_days', count(*) filter (where o.age >= interval '3 days' and o.age < interval '7 days'),
        'over_7_days', count(*) filter (where o.age >= interval '7 days'),
        'oldest_open_hours', coalesce(floor(extract(epoch from max(o.age)) / 3600)::integer, 0)
      )
      from open_tickets as o
    ),
    'resolution', (
      select jsonb_build_object(
        'resolved_in_window', count(*),
        'median_hours', round((percentile_cont(0.5) within group (order by extract(epoch from w.time_to_resolve)) / 3600)::numeric, 1)
      )
      from resolved_in_window as w
    ),
    'created_per_day', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0)) order by d.day)
        from days as d left join created_by_day as c on c.day = d.day
    ),
    'departments', (select coalesce(jsonb_agg(r.row_json order by r.name), '[]'::jsonb) from department_rows as r),
    'ai', (
      select jsonb_build_object(
        'runs', count(*),
        'routed', count(*) filter (where r.outcome = 'routed'),
        'needs_review', count(*) filter (where r.outcome = 'needs_review'),
        'superseded', count(*) filter (where r.outcome = 'superseded'),
        'running', count(*) filter (where r.outcome = 'running'),
        'p50_ms', round((percentile_cont(0.5) within group (order by r.duration_ms))::numeric),
        'p95_ms', round((percentile_cont(0.95) within group (order by r.duration_ms))::numeric),
        'review_reasons', coalesce(
          (select jsonb_object_agg(f.failure_code, f.n)
             from (select w.failure_code, count(*) as n from window_runs as w
                    where w.failure_code is not null group by w.failure_code) as f),
          '{}'::jsonb)
      )
      from window_runs as r
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Department availability
-- ---------------------------------------------------------------------------------------------
create function public.admin_set_department_active(p_department_id uuid, p_active boolean)
returns table (id uuid, is_active boolean, routes_affected integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_department public.departments%rowtype;
begin
  if private.require_actor_role(v_actor) <> 'admin' then
    raise exception 'only administrators can manage departments' using errcode = 'MR403';
  end if;
  if p_active is null then
    raise exception 'choose active or inactive' using errcode = '22023';
  end if;
  select d.* into v_department from public.departments as d where d.id = p_department_id for update;
  if not found then
    raise exception 'department not found' using errcode = 'MR404';
  end if;
  if v_department.is_active = p_active then
    raise exception 'nothing to change' using errcode = 'MR304';
  end if;

  update public.departments as d set is_active = p_active where d.id = v_department.id;

  insert into public.config_changes (changed_by, entity, entity_key, before_value, after_value)
  values (v_actor, 'department', v_department.code,
          jsonb_build_object('is_active', v_department.is_active),
          jsonb_build_object('is_active', p_active));

  -- Rules that point here stop routing while the department is inactive: the AI and the
  -- assignment form both use active departments only, so those categories go to review.
  return query
    select v_department.id, p_active,
           (select count(*)::integer from public.routing_rules as r
             where r.department_id = v_department.id and r.enabled);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Default routing rules
-- ---------------------------------------------------------------------------------------------
create function public.admin_set_routing_rule(
  p_category public.complaint_category,
  p_department_id uuid,
  p_enabled boolean
)
returns table (category public.complaint_category, department_id uuid, enabled boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_before public.routing_rules%rowtype;
  v_department public.departments%rowtype;
begin
  if private.require_actor_role(v_actor) <> 'admin' then
    raise exception 'only administrators can change routing rules' using errcode = 'MR403';
  end if;
  if p_category is null or p_category = 'unclassified' then
    raise exception 'choose a real category' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'choose enabled or disabled' using errcode = '22023';
  end if;
  select d.* into v_department from public.departments as d where d.id = p_department_id;
  if not found then
    raise exception 'department not found' using errcode = 'MR404';
  end if;
  if p_enabled and not v_department.is_active then
    raise exception 'an enabled rule needs an active department' using errcode = '22023';
  end if;

  select r.* into v_before from public.routing_rules as r where r.category = p_category for update;
  if found and v_before.department_id = p_department_id and v_before.enabled = p_enabled then
    raise exception 'nothing to change' using errcode = 'MR304';
  end if;

  insert into public.routing_rules as r (category, department_id, enabled, updated_at)
  values (p_category, p_department_id, p_enabled, now())
  on conflict (category) do update
    set department_id = excluded.department_id, enabled = excluded.enabled, updated_at = now();

  insert into public.config_changes (changed_by, entity, entity_key, before_value, after_value)
  values (v_actor, 'routing_rule', p_category::text,
          case when v_before.category is null then null
               else jsonb_build_object('department_id', v_before.department_id, 'enabled', v_before.enabled) end,
          jsonb_build_object('department_id', p_department_id, 'enabled', p_enabled));

  return query select p_category, p_department_id, p_enabled;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: callable by signed-in users; each function checks the administrator role itself
-- ---------------------------------------------------------------------------------------------
revoke all on function public.admin_metrics(integer) from public, anon, authenticated;
revoke all on function public.admin_set_department_active(uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_set_routing_rule(public.complaint_category, uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.admin_metrics(integer) to authenticated;
grant execute on function public.admin_set_department_active(uuid, boolean) to authenticated;
grant execute on function public.admin_set_routing_rule(public.complaint_category, uuid, boolean)
  to authenticated;
