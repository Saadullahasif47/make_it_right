-- MakeItRight: bounded AI triage (master plan P4.03-P4.08; §4, §8, §9, BR-08, BR-10).
--
--   * The agent never writes tables. The server-only privileged adapter calls exactly two
--     functions, agent_begin_run and agent_finish_run, which only service_role may execute.
--     Signed-in users have no EXECUTE on them (plan §9: never a student-callable route).
--   * agent_finish_run re-checks every routing decision against the database: a real
--     category, an approved low/medium priority, and the active department that routing_rules
--     names for that category. A refused decision raises, so it changes nothing; the adapter
--     then records the run as needing review instead.
--   * Each attempt is an agent_runs row: model, prompt version, outcome, stable failure code,
--     a tool-call trace of names, enum arguments and verdicts, and duration. Complaint text and
--     identities are never stored there (plan §8).
--   * One automatic attempt per ticket. A replayed submission finds a run and refuses (MR409),
--     so retrying an idempotency key never reruns AI. Admin retries are bounded per ticket and
--     per admin, and may take over a run that has been stuck for over two minutes.
--
-- Error codes (mapped in the app):
--   MR403 requester may not do this   MR404 ticket or run not found
--   MR409 already attempted / in progress / run finished   MR422 decision refused by policy
--   MR429 retry limit reached         22023 invalid input

-- ---------------------------------------------------------------------------------------------
-- Schema changes
-- ---------------------------------------------------------------------------------------------
alter type public.ticket_event_type add value if not exists 'triage_started';
alter type public.ticket_event_type add value if not exists 'review_requested';

create type public.agent_run_trigger as enum ('submission', 'admin_retry');
create type public.agent_run_outcome as enum ('running', 'routed', 'needs_review', 'superseded');

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  trigger public.agent_run_trigger not null,
  requested_by uuid references public.profiles (id) on delete set null,
  model text not null constraint agent_runs_model_length check (char_length(model) between 1 and 100),
  prompt_version text not null
    constraint agent_runs_prompt_version_format check (prompt_version ~ '^[a-z0-9][a-z0-9.-]{0,39}$'),
  outcome public.agent_run_outcome not null default 'running',
  failure_code text constraint agent_runs_failure_code_format check (failure_code ~ '^[A-Z][A-Z_]{2,39}$'),
  proposed_category public.complaint_category,
  proposed_department_id uuid references public.departments (id) on delete set null,
  proposed_priority public.ticket_priority,
  tool_calls jsonb not null default '[]'::jsonb
    constraint agent_runs_tool_calls_shape check (
      jsonb_typeof(tool_calls) = 'array' and pg_column_size(tool_calls) <= 8192
    ),
  duration_ms integer constraint agent_runs_duration_positive check (duration_ms >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint agent_runs_finished_when_done check ((outcome = 'running') = (finished_at is null)),
  constraint agent_runs_review_has_reason check (outcome <> 'needs_review' or failure_code is not null),
  constraint agent_runs_routed_has_no_failure check (outcome <> 'routed' or failure_code is null)
);

comment on table public.agent_runs is
  'One row per AI triage attempt (plan §9). No prompts, complaint text or identities.';

create index agent_runs_complaint_recent on public.agent_runs (complaint_id, started_at desc);
create index agent_runs_retry_window on public.agent_runs (requested_by, started_at desc)
  where trigger = 'admin_retry';
-- At most one attempt in flight per ticket.
create unique index agent_runs_one_running on public.agent_runs (complaint_id)
  where outcome = 'running';

alter table public.agent_runs enable row level security;
revoke all on table public.agent_runs from anon, authenticated;
grant select on table public.agent_runs to authenticated;

create policy agent_runs_select_admin
  on public.agent_runs for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------
-- agent_begin_run: claim a ticket for one AI attempt
-- ---------------------------------------------------------------------------------------------
create function public.agent_begin_run(
  p_ticket_id uuid,
  p_trigger public.agent_run_trigger,
  p_requested_by uuid,
  p_model text,
  p_prompt_version text
)
returns table (run_id uuid, ticket_version integer, title text, description text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- Retry bounds (plan §11: durable, not per-process).
  c_max_runs_per_ticket constant integer := 3;
  c_max_retries_per_admin constant integer := 10;
  c_retry_window constant interval := interval '10 minutes';
  c_stale_after constant interval := interval '2 minutes';
  v_role public.app_role;
  v_ticket public.complaints%rowtype;
  v_previous public.ticket_state;
  v_run_id uuid;
begin
  select p.role into v_role from public.profiles as p where p.id = p_requested_by;
  if v_role is null then
    raise exception 'unknown requester' using errcode = 'MR403';
  end if;

  select c.* into v_ticket from public.complaints as c where c.id = p_ticket_id for update;
  if not found then
    raise exception 'ticket not found' using errcode = 'MR404';
  end if;

  if p_trigger = 'submission' then
    -- Only the reporter's own fresh submission starts the automatic attempt.
    if v_ticket.created_by <> p_requested_by then
      raise exception 'only the reporter''s submission starts triage' using errcode = 'MR403';
    end if;
    if v_ticket.status <> 'submitted'
       or exists (select 1 from public.agent_runs as r where r.complaint_id = v_ticket.id) then
      raise exception 'triage was already attempted for this ticket' using errcode = 'MR409';
    end if;
  elsif p_trigger = 'admin_retry' then
    if v_role <> 'admin' then
      raise exception 'only administrators can retry triage' using errcode = 'MR403';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('agent_retry:' || p_requested_by::text, 0));
    if (select count(*) from public.agent_runs as r
         where r.requested_by = p_requested_by and r.trigger = 'admin_retry'
           and r.started_at > now() - c_retry_window) >= c_max_retries_per_admin then
      raise exception 'too many AI retries, try again later' using errcode = 'MR429';
    end if;
    if (select count(*) from public.agent_runs as r where r.complaint_id = v_ticket.id)
       >= c_max_runs_per_ticket then
      raise exception 'AI retry limit reached for this ticket' using errcode = 'MR429';
    end if;

    if v_ticket.status = 'triaging' then
      -- A live attempt is left alone; one stuck past the threshold (its function stopped
      -- after commit, plan §4 step 7) is superseded so the retry can take over.
      if exists (select 1 from public.agent_runs as r
                  where r.complaint_id = v_ticket.id and r.outcome = 'running'
                    and r.started_at > now() - c_stale_after) then
        raise exception 'an AI attempt is still in progress' using errcode = 'MR409';
      end if;
      update public.agent_runs as r
         set outcome = 'superseded', failure_code = 'ABANDONED', finished_at = now()
       where r.complaint_id = v_ticket.id and r.outcome = 'running';
    elsif v_ticket.status not in ('submitted', 'needs_review') then
      raise exception 'tickets in status % are not awaiting routing', v_ticket.status using errcode = 'MR422';
    end if;
  else
    raise exception 'unknown trigger' using errcode = '22023';
  end if;

  v_previous := v_ticket.status;
  update public.complaints as c
     set status = 'triaging', version = c.version + 1
   where c.id = v_ticket.id
  returning * into v_ticket;

  insert into public.ticket_events (complaint_id, event_type, actor_kind, previous_status, new_status)
  values (v_ticket.id, 'triage_started', 'agent', v_previous, 'triaging');

  insert into public.agent_runs (complaint_id, trigger, requested_by, model, prompt_version)
  values (v_ticket.id, p_trigger, p_requested_by, p_model, p_prompt_version)
  returning id into v_run_id;

  return query select v_run_id, v_ticket.version, v_ticket.title, v_ticket.description;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- agent_finish_run: apply a validated decision, or hand the ticket to a human
-- ---------------------------------------------------------------------------------------------
create function public.agent_finish_run(
  p_run_id uuid,
  p_expected_version integer,
  p_outcome public.agent_run_outcome,
  p_category public.complaint_category default null,
  p_department_id uuid default null,
  p_priority public.ticket_priority default null,
  p_reason text default null,
  p_failure_code text default null,
  p_tool_calls jsonb default '[]'::jsonb,
  p_duration_ms integer default null
)
returns table (outcome public.agent_run_outcome, status public.ticket_state, version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_complaint_id uuid;
  v_ticket public.complaints%rowtype;
  v_run public.agent_runs%rowtype;
  v_route uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_proposed_department uuid;
  v_tool_calls jsonb := coalesce(p_tool_calls, '[]'::jsonb);
begin
  select r.complaint_id into v_complaint_id from public.agent_runs as r where r.id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'MR404';
  end if;

  -- Same lock order as agent_begin_run (ticket, then run), so the two cannot deadlock.
  select c.* into v_ticket from public.complaints as c where c.id = v_complaint_id for update;
  select r.* into v_run from public.agent_runs as r where r.id = p_run_id for update;
  if v_run.outcome <> 'running' then
    raise exception 'run already finished' using errcode = 'MR409';
  end if;
  if p_outcome not in ('routed', 'needs_review') then
    raise exception 'outcome must be routed or needs_review' using errcode = '22023';
  end if;
  if jsonb_typeof(v_tool_calls) <> 'array' or (p_duration_ms is not null and p_duration_ms < 0) then
    raise exception 'invalid run metadata' using errcode = '22023';
  end if;

  -- A proposal is kept for the admin only if it names a real department.
  select d.id into v_proposed_department from public.departments as d where d.id = p_department_id;

  -- Someone acted while the model was thinking (an admin routed it, or a retry took over).
  -- Record the attempt and leave the ticket exactly as they left it.
  if v_ticket.status <> 'triaging' or v_ticket.version <> p_expected_version then
    update public.agent_runs as r
       set outcome = 'superseded', failure_code = 'TICKET_CHANGED',
           proposed_category = p_category, proposed_department_id = v_proposed_department,
           proposed_priority = p_priority, tool_calls = v_tool_calls,
           duration_ms = p_duration_ms, finished_at = now()
     where r.id = v_run.id;
    return query select 'superseded'::public.agent_run_outcome, v_ticket.status, v_ticket.version;
    return;
  end if;

  if p_outcome = 'routed' then
    if p_failure_code is not null then
      raise exception 'a routed run has no failure code' using errcode = '22023';
    end if;
    if p_category is null or p_category = 'unclassified' then
      raise exception 'routing needs a real category' using errcode = 'MR422';
    end if;
    -- Urgent or unassessed reports are never approved autonomously (BR-08).
    if p_priority is null or p_priority not in ('low', 'medium') then
      raise exception 'only low or medium priority can be routed without review' using errcode = 'MR422';
    end if;
    select rr.department_id into v_route
      from public.routing_rules as rr
      join public.departments as d on d.id = rr.department_id and d.is_active
     where rr.category = p_category and rr.enabled;
    if v_route is null or v_route is distinct from p_department_id then
      raise exception 'department is not the approved route for this category' using errcode = 'MR422';
    end if;
    if v_reason is null or char_length(v_reason) not between 5 and 280 then
      raise exception 'a short reason of 5 to 280 characters is required' using errcode = '22023';
    end if;

    update public.complaints as c
       set category = p_category,
           priority = p_priority,
           assigned_department_id = v_route,
           status = 'assigned',
           acknowledged_at = null,
           version = c.version + 1
     where c.id = v_ticket.id
    returning * into v_ticket;

    insert into public.ticket_events
      (complaint_id, event_type, actor_kind, previous_status, new_status,
       department_id, category, priority, note)
    values
      (v_ticket.id, 'assigned', 'agent', 'triaging', 'assigned',
       v_route, p_category, p_priority, v_reason);
  else
    if p_failure_code is null or p_failure_code !~ '^[A-Z][A-Z_]{2,39}$' then
      raise exception 'a review needs a failure code' using errcode = '22023';
    end if;

    update public.complaints as c
       set status = 'needs_review', version = c.version + 1
     where c.id = v_ticket.id
    returning * into v_ticket;

    -- The reporter sees a plain explanation in the app; the code stays on the admin-only run.
    insert into public.ticket_events (complaint_id, event_type, actor_kind, previous_status, new_status)
    values (v_ticket.id, 'review_requested', 'agent', 'triaging', 'needs_review');
  end if;

  update public.agent_runs as r
     set outcome = p_outcome,
         failure_code = case when p_outcome = 'routed' then null else p_failure_code end,
         proposed_category = p_category,
         proposed_department_id = v_proposed_department,
         proposed_priority = p_priority,
         tool_calls = v_tool_calls,
         duration_ms = p_duration_ms,
         finished_at = now()
   where r.id = v_run.id;

  return query select p_outcome, v_ticket.status, v_ticket.version;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: the privileged path is service_role only
-- ---------------------------------------------------------------------------------------------
revoke all on function public.agent_begin_run(uuid, public.agent_run_trigger, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_finish_run(uuid, integer, public.agent_run_outcome,
  public.complaint_category, uuid, public.ticket_priority, text, text, jsonb, integer)
  from public, anon, authenticated;

grant execute on function public.agent_begin_run(uuid, public.agent_run_trigger, uuid, text, text)
  to service_role;
grant execute on function public.agent_finish_run(uuid, integer, public.agent_run_outcome,
  public.complaint_category, uuid, public.ticket_priority, text, text, jsonb, integer)
  to service_role;
