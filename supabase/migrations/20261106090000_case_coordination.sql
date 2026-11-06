-- MakeItRight add-on A4: work orders and the case-aware coordination agent (Advanced Features plan
-- v2 §08, F3.01-F3.05, A4.01-A4.03).
--
--   * case_work_orders: the department responsible for a case right now. Exactly one active work
--     order per case (unique index). A trigger keeps it in step with the case's routing, whatever
--     routed it (ticket workflow, the coordinator, or an admin's approval), so routing has one
--     source of truth and every change is history.
--   * The coordinator is one bounded agent that runs in the queue worker. It reads approved,
--     scoped context through service-role functions, and its final answer is a proposal. Code
--     decides: a low-risk proposal is committed once; anything else waits for an admin.
--   * coordination_runs (the readable trace) and work_order_proposals are admin-only. A commit is
--     version-checked (MR412 on a stale case), creates one work order, routes every report of the
--     case through the audited sync, and is recorded on the case, its tickets and the proposal.
--   * The agent cannot close cases, change roles, read staff identities or write anything except
--     through worker_finish_coordination, which re-checks the routing rule, the case version and
--     the priority rule itself.

-- ---------------------------------------------------------------------------------------------
-- Work orders (F3.03)
-- ---------------------------------------------------------------------------------------------
create type public.work_order_status as enum ('active', 'completed', 'cancelled');
create type public.work_order_source as enum ('ticket_routing', 'coordinator', 'admin_approved');

create table public.case_work_orders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  status public.work_order_status not null default 'active',
  source public.work_order_source not null,
  proposal_id uuid,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1 constraint case_work_orders_version_positive check (version > 0),
  constraint case_work_orders_completed_at check ((status = 'completed') = (completed_at is not null)),
  constraint case_work_orders_cancelled_at check ((status = 'cancelled') = (cancelled_at is not null))
);

comment on table public.case_work_orders is
  'Which department works a case (plan v2 F3). One active work order per case; history kept.';

create unique index case_work_orders_one_active on public.case_work_orders (case_id) where status = 'active';
create index case_work_orders_department_idx on public.case_work_orders (department_id, status);
create index case_work_orders_case_idx on public.case_work_orders (case_id, assigned_at desc);

-- The case version a coordination job was asked for (plan §08: COORDINATION(case_id,
-- expected_version)). A case that changes while the job waits makes its run superseded.
alter table public.ai_jobs add column target_version integer
  constraint ai_jobs_target_version_positive check (target_version is null or target_version > 0);

-- ---------------------------------------------------------------------------------------------
-- Coordinator runs and proposals (F3.01, F3.04, F3.05)
-- ---------------------------------------------------------------------------------------------
create type public.coordination_outcome as enum ('committed', 'awaiting_approval', 'review_requested', 'superseded');
create type public.proposal_status as enum ('pending', 'committed', 'rejected', 'stale');

create table public.coordination_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  -- One run per job: a retried job that already finished never records twice.
  job_id uuid unique references public.ai_jobs (id) on delete set null,
  model text not null constraint coordination_runs_model_format check (model ~ '^[a-z0-9][a-z0-9.-]{1,63}$'),
  prompt_version text not null constraint coordination_runs_prompt_format check (prompt_version ~ '^coordinator-v[0-9]+$'),
  outcome public.coordination_outcome not null,
  -- Why it ended in review, or why the database refused the proposal.
  reason_code text constraint coordination_runs_reason_format check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
  -- Tool names, scoped ids and verdicts only; never prompts or report text (as agent_runs, ADR 0005).
  tool_trace jsonb not null default '[]'::jsonb constraint coordination_runs_trace_array check (jsonb_typeof(tool_trace) = 'array'),
  case_version integer not null,
  duration_ms integer constraint coordination_runs_duration_range check (duration_ms is null or duration_ms between 0 and 600000),
  created_at timestamptz not null default now()
);

comment on table public.coordination_runs is 'One bounded coordinator attempt per row, with its tool trace (plan v2 F3.05).';

create index coordination_runs_case_idx on public.coordination_runs (case_id, created_at desc);

create table public.work_order_proposals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  run_id uuid not null unique references public.coordination_runs (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  category public.complaint_category not null
    constraint work_order_proposals_category_classified check (category <> 'unclassified'),
  priority public.ticket_priority not null
    constraint work_order_proposals_priority_assessed check (priority <> 'unassessed'),
  rationale text not null constraint work_order_proposals_rationale_length check (char_length(rationale) between 1 and 400),
  expected_case_version integer not null,
  -- Why a person must approve it; empty when the policy allowed an automatic commit.
  policy_reasons text[] not null default '{}'
    constraint work_order_proposals_reasons_format check (array_to_string(policy_reasons, ',') ~ '^([A-Z_]{3,40}(,[A-Z_]{3,40})*)?$'),
  status public.proposal_status not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text constraint work_order_proposals_note_length check (decision_note is null or char_length(decision_note) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint work_order_proposals_decided check ((status = 'pending') = (decided_at is null))
);

comment on table public.work_order_proposals is
  'Work orders the coordinator proposed. Committed only by policy or by an admin.';

create unique index work_order_proposals_one_pending on public.work_order_proposals (case_id) where status = 'pending';

alter table public.case_work_orders
  add constraint case_work_orders_proposal_fkey
  foreign key (proposal_id) references public.work_order_proposals (id) on delete set null;

create trigger coordination_runs_immutable
  before update on public.coordination_runs
  for each row execute function private.reject_history_update();

-- ---------------------------------------------------------------------------------------------
-- RLS: work orders with the case; runs and proposals for admins only
-- ---------------------------------------------------------------------------------------------
alter table public.case_work_orders enable row level security;
alter table public.coordination_runs enable row level security;
alter table public.work_order_proposals enable row level security;
revoke all on table public.case_work_orders, public.coordination_runs, public.work_order_proposals
  from anon, authenticated;
grant select on table public.case_work_orders, public.coordination_runs, public.work_order_proposals to authenticated;

create policy case_work_orders_select_with_case
  on public.case_work_orders for select
  to authenticated
  using (exists (select 1 from public.maintenance_cases as mc where mc.id = case_id));

create policy coordination_runs_select_admin
  on public.coordination_runs for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');

create policy work_order_proposals_select_admin
  on public.work_order_proposals for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------
-- Keeping the active work order in step with the case
-- ---------------------------------------------------------------------------------------------
create function private.sync_work_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.case_work_orders;
  v_source public.work_order_source :=
    coalesce(nullif(current_setting('makeitright.work_order_source', true), ''), 'ticket_routing')::public.work_order_source;
  v_proposal uuid := nullif(current_setting('makeitright.work_order_proposal', true), '')::uuid;
begin
  select w.* into v_active from public.case_work_orders as w
   where w.case_id = new.id and w.status = 'active'
     for update;

  if new.status = 'closed' then
    update public.case_work_orders as w
       set status = 'completed', completed_at = now(), version = w.version + 1
     where w.id = v_active.id;
    return null;
  end if;
  if new.status = 'merged' or new.assigned_department_id is null then
    update public.case_work_orders as w
       set status = 'cancelled', cancelled_at = now(), version = w.version + 1
     where w.id = v_active.id;
    return null;
  end if;
  if v_active.id is not null and v_active.department_id = new.assigned_department_id then
    return null;
  end if;

  -- A new department takes over: the previous work order ends, one new one starts.
  update public.case_work_orders as w
     set status = 'cancelled', cancelled_at = now(), version = w.version + 1
   where w.id = v_active.id;
  insert into public.case_work_orders (case_id, department_id, source, proposal_id)
  values (new.id, new.assigned_department_id, v_source, v_proposal);
  return null;
end;
$$;

revoke all on function private.sync_work_order() from public, anon, authenticated;

create trigger maintenance_cases_sync_work_order
  after update of status, assigned_department_id on public.maintenance_cases
  for each row
  when (old.status is distinct from new.status or old.assigned_department_id is distinct from new.assigned_department_id)
  execute function private.sync_work_order();

-- Backfill: every open, routed case that came from a real report gets its active work order.
insert into public.case_work_orders (case_id, department_id, source, assigned_at)
select mc.id, mc.assigned_department_id, 'ticket_routing', mc.updated_at
  from public.maintenance_cases as mc
 where mc.assigned_department_id is not null
   and mc.status not in ('closed', 'merged')
   and not mc.is_synthetic;

-- ---------------------------------------------------------------------------------------------
-- Committing a work order (F3.03): one transaction, version-checked
-- ---------------------------------------------------------------------------------------------
create function private.commit_work_order(
  p_proposal_id uuid,
  p_source public.work_order_source,
  p_actor uuid,
  p_expected_case_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.work_order_proposals;
  v_case public.maintenance_cases;
  v_report uuid;
  v_note text;
begin
  select p.* into strict v_proposal from public.work_order_proposals as p where p.id = p_proposal_id for update;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal already decided' using errcode = 'MR422';
  end if;

  select mc.* into strict v_case from public.maintenance_cases as mc where mc.id = v_proposal.case_id for update;
  if v_case.status in ('closed', 'merged') then
    raise exception 'the case is no longer open' using errcode = 'MR422';
  end if;
  -- Callers mark a proposal stale themselves: a raise here would roll that marking back.
  if v_case.version is distinct from p_expected_case_version
     or v_case.version is distinct from v_proposal.expected_case_version then
    raise exception 'the case changed after the proposal' using errcode = 'MR412';
  end if;

  v_note := case p_source
    when 'coordinator' then format('Work order from the AI coordinator (low-risk, approved by policy): %s.', v_proposal.rationale)
    else format('Work order from the AI coordinator, approved by an administrator: %s.', v_proposal.rationale)
  end;

  perform set_config('makeitright.work_order_source', p_source::text, true);
  perform set_config('makeitright.work_order_proposal', v_proposal.id::text, true);
  update public.maintenance_cases as mc
     set assigned_department_id = v_proposal.department_id,
         category = v_proposal.category,
         priority = v_proposal.priority,
         status = case when mc.status in ('open', 'needs_review') then 'assigned' else mc.status end,
         version = mc.version + 1
   where mc.id = v_case.id
  returning mc.* into v_case;
  perform set_config('makeitright.work_order_source', '', true);
  perform set_config('makeitright.work_order_proposal', '', true);

  insert into public.case_events (case_id, event_type, actor_id, actor_kind, previous_status, new_status, department_id, note)
  values (v_case.id, 'assigned', p_actor, case when p_actor is null then 'agent' else 'user' end::public.ticket_actor_kind,
          v_case.status, v_case.status, v_proposal.department_id, left(v_note, 1000));

  for v_report in
    select cr.complaint_id from public.case_reports as cr where cr.case_id = v_case.id order by cr.linked_at
  loop
    perform private.apply_case_to_ticket(v_case, v_report, left(v_note, 1000), 'assigned');
  end loop;

  update public.work_order_proposals as p
     set status = 'committed', decided_by = p_actor, decided_at = now()
   where p.id = v_proposal.id;
  return (select w.id from public.case_work_orders as w where w.case_id = v_case.id and w.status = 'active');
end;
$$;

revoke all on function private.commit_work_order(uuid, public.work_order_source, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions for administrators
-- ---------------------------------------------------------------------------------------------
-- Queues one coordinator run for a case (F3, A4.01; plan §12: department or admin). A department
-- may ask only about a case it holds; anything that would move the case away from it needs an
-- admin's approval (REASSIGNMENT). Asking again while a run is queued returns the same job; after
-- a run finished, a new request starts a new one.
create function public.request_case_coordination(p_case_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.maintenance_cases;
  v_runs integer;
  v_job uuid;
  v_role public.app_role := (select private.current_app_role());
begin
  if v_role is distinct from 'admin' and v_role is distinct from 'department' then
    raise exception 'admins and departments only' using errcode = 'MR403';
  end if;
  select mc.* into v_case from public.maintenance_cases as mc where mc.id = p_case_id;
  -- Synthetic history (heatmap demo data) is never coordinated.
  if not found or v_case.is_synthetic
     or (v_role = 'department' and v_case.assigned_department_id is distinct from (select private.current_department_id())) then
    raise exception 'case not found' using errcode = 'MR404';
  end if;
  if v_case.status in ('closed', 'merged') then
    raise exception 'the case is no longer open' using errcode = 'MR422';
  end if;
  select count(*) into v_runs from public.coordination_runs as r where r.case_id = p_case_id;
  -- Each run is a paid model call: at most five per case a day.
  if (select count(*) from public.coordination_runs as r
       where r.case_id = p_case_id and r.created_at > now() - interval '1 day') >= 5 then
    raise exception 'coordination limit reached for this case' using errcode = 'MR429';
  end if;
  -- The version is part of the dedupe key, so one job always carries one version.
  v_job := private.enqueue_ai_job(
    'coordination', p_case_id,
    format('coordination:%s:v%s:r%s', p_case_id, v_case.version, v_runs));
  update public.ai_jobs as j set target_version = v_case.version
   where j.id = v_job and j.target_version is null;
  return v_job;
end;
$$;

-- An administrator approves or rejects a pending proposal (F3.04). Approving commits it against
-- the case version the admin saw. Returns 'committed', 'rejected' or 'stale': a case that changed
-- after the proposal retires it (kept, not raised, so the marking survives); a page older than
-- the case is MR412 and changes nothing.
create function public.admin_decide_proposal(
  p_proposal_id uuid,
  p_approve boolean,
  p_expected_case_version integer,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_proposal public.work_order_proposals;
  v_case_version integer;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'admins only' using errcode = 'MR403';
  end if;
  select p.* into v_proposal from public.work_order_proposals as p where p.id = p_proposal_id for update;
  if not found then
    raise exception 'proposal not found' using errcode = 'MR404';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal already decided' using errcode = 'MR422';
  end if;

  if not p_approve then
    update public.work_order_proposals as p
       set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = left(v_note, 500)
     where p.id = v_proposal.id;
    return 'rejected';
  end if;

  select mc.version into v_case_version from public.maintenance_cases as mc where mc.id = v_proposal.case_id for update;
  if v_case_version is distinct from v_proposal.expected_case_version then
    update public.work_order_proposals as p
       set status = 'stale', decided_by = v_actor, decided_at = now(), decision_note = left(v_note, 500)
     where p.id = v_proposal.id;
    return 'stale';
  end if;
  if v_case_version is distinct from p_expected_case_version then
    raise exception 'the page is older than the case' using errcode = 'MR412';
  end if;

  update public.work_order_proposals as p set decision_note = left(v_note, 500) where p.id = v_proposal.id;
  perform private.commit_work_order(v_proposal.id, 'admin_approved', v_actor, p_expected_case_version);
  return 'committed';
end;
$$;

revoke all on function public.request_case_coordination(uuid) from public, anon, authenticated;
revoke all on function public.admin_decide_proposal(uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.request_case_coordination(uuid) to authenticated;
grant execute on function public.admin_decide_proposal(uuid, boolean, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Worker read functions (F3.02): bounded, scoped, no identities
-- ---------------------------------------------------------------------------------------------
-- The case the coordinator works on: its state, place, equipment and up to five reports
-- (title, description, place; never who reported them).
create function public.worker_case_context(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'case_id', mc.id,
    'reference', 'MC-' || mc.reference_no,
    'status', mc.status,
    'version', mc.version,
    'category', mc.category,
    'priority', mc.priority,
    'opened_at', mc.opened_at,
    'location', case when l.id is null then null else jsonb_build_object(
      'location_id', l.id, 'building', l.building_name, 'room', l.room_code) end,
    'asset', case when a.id is null then null else jsonb_build_object(
      'asset_id', a.id, 'code', a.asset_code, 'label', a.label) end,
    'department', case when d.id is null then null else jsonb_build_object('department_id', d.id, 'name', d.name) end,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reference', 'MIR-' || c.reference_no, 'title', c.title, 'description', c.description,
               'building', c.building, 'room', c.room) order by c.created_at)
        from (select c.* from public.case_reports as cr join public.complaints as c on c.id = cr.complaint_id
               where cr.case_id = mc.id order by c.created_at limit 5) as c
    ), '[]'::jsonb),
    'report_count', (select count(*) from public.case_reports as cr where cr.case_id = mc.id)
  )
    from public.maintenance_cases as mc
    left join public.maintenance_locations as l on l.id = mc.location_id
    left join public.asset_registry as a on a.id = mc.asset_id
    left join public.departments as d on d.id = mc.assigned_department_id
   where mc.id = p_case_id;
$$;

-- Recent cases of one piece of equipment (for repeat failures).
create function public.worker_asset_history(p_asset_id uuid, p_days integer default 90)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'reference', 'MC-' || h.reference_no, 'status', h.status, 'category', h.category,
           'opened_at', h.opened_at, 'closed_at', h.closed_at) order by h.opened_at desc), '[]'::jsonb)
    from (select mc.* from public.maintenance_cases as mc
           where mc.asset_id = p_asset_id and mc.status <> 'merged'
             and mc.opened_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
           order by mc.opened_at desc limit 10) as h;
$$;

-- A department's current load: counts and the categories it is the default route for. No staff.
create function public.worker_department_capacity(p_department_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'department_id', d.id,
    'name', d.name,
    'is_active', d.is_active,
    'active_work_orders', (select count(*) from public.case_work_orders as w
                             where w.department_id = d.id and w.status = 'active'),
    'default_for', coalesce((select jsonb_agg(r.category order by r.category) from public.routing_rules as r
                              where r.department_id = d.id and r.enabled), '[]'::jsonb)
  )
    from public.departments as d
   where d.id = p_department_id;
$$;

-- Recent cases in the same room, optionally of one category.
create function public.worker_related_cases(p_location_id uuid, p_category public.complaint_category, p_exclude_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'reference', 'MC-' || r.reference_no, 'status', r.status, 'category', r.category,
           'opened_at', r.opened_at) order by r.opened_at desc), '[]'::jsonb)
    from (select mc.* from public.maintenance_cases as mc
           where mc.location_id = p_location_id and mc.id <> p_exclude_case and mc.status <> 'merged'
             and (p_category is null or mc.category = p_category)
             and mc.opened_at > now() - interval '90 days'
           order by mc.opened_at desc limit 10) as r;
$$;

-- The approved routes the coordinator may propose (active departments with enabled rules).
create function public.worker_approved_routes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', r.category, 'department_id', d.id, 'department', d.name)
                            order by r.category), '[]'::jsonb)
    from public.routing_rules as r
    join public.departments as d on d.id = r.department_id
   where r.enabled and d.is_active;
$$;

-- ---------------------------------------------------------------------------------------------
-- Recording a run (worker, service role)
-- ---------------------------------------------------------------------------------------------
-- Stores one coordinator run and its proposal, and commits it when the worker's policy allowed
-- it and the database agrees: the case is unchanged, the department is the approved route for the
-- category, and neither the case nor the proposal is high priority. Anything else waits for an
-- admin. Idempotent per job.
create function public.worker_finish_coordination(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_model text,
  p_prompt_version text,
  p_case_version integer,
  p_tool_trace jsonb,
  p_duration_ms integer,
  p_reason_code text,
  p_proposal jsonb,
  p_policy_reasons text[],
  p_auto_commit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
  v_case public.maintenance_cases;
  v_run_id uuid;
  v_proposal_id uuid;
  v_outcome public.coordination_outcome;
  v_reason text := p_reason_code;
  v_reasons text[] := coalesce(p_policy_reasons, '{}');
  v_department uuid;
  v_category public.complaint_category;
  v_priority public.ticket_priority;
begin
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);
  if v_job.job_type <> 'coordination' then
    raise exception 'not a coordination job' using errcode = '22023';
  end if;

  select r.id into v_run_id from public.coordination_runs as r where r.job_id = v_job.id;
  if found then
    return (select jsonb_build_object('run_id', r.id, 'outcome', r.outcome) from public.coordination_runs as r where r.id = v_run_id);
  end if;

  select mc.* into strict v_case from public.maintenance_cases as mc where mc.id = v_job.target_id for update;

  if v_case.version is distinct from p_case_version
     or v_case.version is distinct from coalesce(v_job.target_version, v_case.version)
     or v_case.status in ('closed', 'merged') then
    v_outcome := 'superseded';
    v_reason := 'CASE_CHANGED';
  elsif p_proposal is null then
    v_outcome := 'review_requested';
    v_reason := coalesce(v_reason, 'MODEL_REQUESTED_REVIEW');
  else
    v_department := (p_proposal ->> 'department_id')::uuid;
    v_category := (p_proposal ->> 'category')::public.complaint_category;
    v_priority := (p_proposal ->> 'priority')::public.ticket_priority;
    if not exists (
      select 1 from public.routing_rules as r join public.departments as d on d.id = r.department_id
       where r.category = v_category and r.department_id = v_department and r.enabled and d.is_active
    ) then
      v_outcome := 'review_requested';
      v_reason := 'POLICY_REJECTED';
    elsif p_auto_commit and cardinality(v_reasons) = 0 and v_priority <> 'high' and v_case.priority <> 'high' then
      v_outcome := 'committed';
    else
      v_outcome := 'awaiting_approval';
      if v_priority = 'high' or v_case.priority = 'high' then
        v_reasons := array(select distinct x from unnest(v_reasons || array['HIGH_PRIORITY']) as x order by x);
      end if;
    end if;
  end if;

  insert into public.coordination_runs (case_id, job_id, model, prompt_version, outcome, reason_code, tool_trace, case_version, duration_ms)
  values (v_case.id, v_job.id, p_model, p_prompt_version, v_outcome, v_reason, coalesce(p_tool_trace, '[]'::jsonb),
          p_case_version, p_duration_ms)
  returning id into v_run_id;

  if v_outcome in ('committed', 'awaiting_approval') then
    -- A newer proposal replaces an older pending one for the same case.
    update public.work_order_proposals as p set status = 'stale', decided_at = now()
     where p.case_id = v_case.id and p.status = 'pending';
    insert into public.work_order_proposals
      (case_id, run_id, department_id, category, priority, rationale, expected_case_version, policy_reasons)
    values (v_case.id, v_run_id, v_department, v_category, v_priority, left(p_proposal ->> 'rationale', 400),
            p_case_version, case when v_outcome = 'committed' then '{}' else v_reasons end)
    returning id into v_proposal_id;
    if v_outcome = 'committed' then
      perform private.commit_work_order(v_proposal_id, 'coordinator', null, p_case_version);
    end if;
  end if;

  return jsonb_build_object('run_id', v_run_id, 'outcome', v_outcome, 'proposal_id', v_proposal_id);
end;
$$;

revoke all on function public.worker_case_context(uuid) from public, anon, authenticated;
revoke all on function public.worker_asset_history(uuid, integer) from public, anon, authenticated;
revoke all on function public.worker_department_capacity(uuid) from public, anon, authenticated;
revoke all on function public.worker_related_cases(uuid, public.complaint_category, uuid) from public, anon, authenticated;
revoke all on function public.worker_approved_routes() from public, anon, authenticated;
revoke all on function public.worker_finish_coordination(uuid, bigint, smallint, text, text, integer, jsonb, integer, text, jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.worker_case_context(uuid) to service_role;
grant execute on function public.worker_asset_history(uuid, integer) to service_role;
grant execute on function public.worker_department_capacity(uuid) to service_role;
grant execute on function public.worker_related_cases(uuid, public.complaint_category, uuid) to service_role;
grant execute on function public.worker_approved_routes() to service_role;
grant execute on function public.worker_finish_coordination(uuid, bigint, smallint, text, text, integer, jsonb, integer, text, jsonb, text[], boolean)
  to service_role;
