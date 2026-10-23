-- MakeItRight: department workflow and audit (master plan P3.01-P3.03; §5, §6, BR-02-BR-07).
--
--   * A transition table (private.ticket_transitions) is the single source of which status
--     changes each role may make. A pure TypeScript copy drives the UI; an integration test
--     compares the two through public.ticket_transition_rules().
--   * Every change goes through one audited function. Each one reads the caller's role and
--     department from the database, locks the ticket row, requires the expected version
--     (BR-07: a stale write is refused, never silently applied) and appends an event in the
--     same transaction (BR-04).
--   * Tickets a caller may not see are reported as missing (MR404), never as forbidden.
--
-- Error codes (mapped to HTTP in the app):
--   42501 not signed in      MR403 role may not do this     MR404 not found / not visible
--   MR412 stale version      MR422 not allowed in the current status
--   22023 invalid input (missing note, inactive department, nothing to change)

-- ---------------------------------------------------------------------------------------------
-- Schema changes
-- ---------------------------------------------------------------------------------------------
alter type public.ticket_event_type add value if not exists 'assigned';
alter type public.ticket_event_type add value if not exists 'acknowledged';
alter type public.ticket_event_type add value if not exists 'status_changed';
alter type public.ticket_event_type add value if not exists 'note_added';

alter table public.complaints add column acknowledged_at timestamptz;

-- Snapshots kept on each event so a timeline can say "Electrical staff" or "Administrator"
-- without letting students read staff profiles, and can show what an assignment changed.
alter table public.ticket_events
  add column actor_role public.app_role,
  add column department_id uuid references public.departments (id) on delete set null,
  add column category public.complaint_category,
  add column priority public.ticket_priority;

-- Backfill the role of existing CREATED events. History is append-only, so the guard trigger
-- is paused for exactly this statement inside the migration's transaction.
alter table public.ticket_events disable trigger ticket_events_append_only;
update public.ticket_events as e
   set actor_role = p.role
  from public.profiles as p
 where p.id = e.actor_id and e.actor_role is null;
alter table public.ticket_events enable trigger ticket_events_append_only;

create table private.ticket_transitions (
  from_state public.ticket_state not null,
  to_state public.ticket_state not null,
  actor_role public.app_role not null,
  primary key (from_state, to_state, actor_role),
  constraint ticket_transitions_change_state check (from_state <> to_state)
);

comment on table private.ticket_transitions is
  'Legal status changes by role (plan §6). Assignment and AI routing use their own functions.';

insert into private.ticket_transitions (from_state, to_state, actor_role) values
  -- Department staff work tickets assigned to their department (BR-02).
  ('assigned', 'in_progress', 'department'),
  ('reopened', 'in_progress', 'department'),
  ('in_progress', 'resolved', 'department'),
  -- The reporter confirms or disputes a resolution (BR-03).
  ('resolved', 'closed', 'student'),
  ('resolved', 'reopened', 'student'),
  -- Admins may perform any of these, always with an audit event (plan §5).
  ('assigned', 'in_progress', 'admin'),
  ('reopened', 'in_progress', 'admin'),
  ('in_progress', 'resolved', 'admin'),
  ('resolved', 'closed', 'admin'),
  ('resolved', 'reopened', 'admin');

create table public.routing_rules (
  category public.complaint_category primary key
    constraint routing_rules_classified check (category <> 'unclassified'),
  department_id uuid not null references public.departments (id) on delete restrict,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.routing_rules is 'Default department for each category (plan §9).';

alter table public.routing_rules enable row level security;
revoke all on table public.routing_rules from anon, authenticated;
grant select on table public.routing_rules to authenticated;

create policy routing_rules_select_admin
  on public.routing_rules for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------
-- Internal helpers (owner-only; called from the SECURITY DEFINER functions below)
-- ---------------------------------------------------------------------------------------------
-- The caller's role, or an error when there is no signed-in user with a profile.
create function private.require_actor_role(p_actor uuid)
returns public.app_role
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role from public.profiles as p where p.id = p_actor;
  if p_actor is null or v_role is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Locks the ticket for update if the caller may see it, applying the same rules as the read
-- policy. Missing and invisible tickets are indistinguishable (no probing of ids).
create function private.lock_visible_ticket(p_ticket_id uuid, p_actor uuid, p_role public.app_role)
returns public.complaints
language plpgsql
set search_path = ''
as $$
declare
  v_ticket public.complaints%rowtype;
begin
  select c.* into v_ticket from public.complaints as c where c.id = p_ticket_id for update;

  if not found
     or (p_role = 'student' and v_ticket.created_by <> p_actor)
     or (p_role = 'department' and v_ticket.assigned_department_id is distinct from
           (select p.department_id from public.profiles as p where p.id = p_actor)) then
    raise exception 'ticket not found' using errcode = 'MR404';
  end if;

  return v_ticket;
end;
$$;

create function private.require_version(p_ticket public.complaints, p_expected integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null or p_ticket.version <> p_expected then
    raise exception 'ticket changed since it was loaded' using errcode = 'MR412';
  end if;
end;
$$;

create function private.normalise_note(p_note text, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
begin
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if p_required and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;
  return v_note;
end;
$$;

revoke all on function private.require_actor_role(uuid) from public, anon, authenticated;
revoke all on function private.lock_visible_ticket(uuid, uuid, public.app_role) from public, anon, authenticated;
revoke all on function private.require_version(public.complaints, integer) from public, anon, authenticated;
revoke all on function private.normalise_note(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- create_ticket: unchanged behaviour, now records the creator's role on the CREATED event
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_ticket(
  p_title text,
  p_description text,
  p_building text,
  p_room text,
  p_idempotency_key uuid
)
returns table (id uuid, reference_no integer, status public.ticket_state, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_title text := btrim(p_title);
  v_description text := btrim(p_description);
  v_building text := btrim(p_building);
  v_room text := nullif(btrim(p_room), '');
  v_hash text;
  v_existing record;
  v_complaint public.complaints%rowtype;
begin
  v_role := private.require_actor_role(v_actor);
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22004';
  end if;

  v_hash := encode(
    sha256(convert_to(jsonb_build_array(v_title, v_description, v_building, v_room)::text, 'UTF8')),
    'hex'
  );

  -- Serialise all ticket creation by this user (idempotency and rate limit, see ADR 0003).
  perform pg_advisory_xact_lock(hashtextextended('create_ticket:' || v_actor::text, 0));

  select k.complaint_id, k.request_hash into v_existing
    from public.submission_keys as k
   where k.actor_id = v_actor and k.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency key reused with different content' using errcode = 'MR409';
    end if;
    return query
      select c.id, c.reference_no, c.status, false
        from public.complaints as c
       where c.id = v_existing.complaint_id;
    return;
  end if;

  if (select count(*) from public.complaints as c
       where c.created_by = v_actor and c.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'too many submissions' using errcode = 'MR429';
  end if;

  insert into public.complaints (created_by, title, description, building, room)
  values (v_actor, v_title, v_description, v_building, v_room)
  returning * into v_complaint;

  insert into public.submission_keys (actor_id, idempotency_key, complaint_id, request_hash)
  values (v_actor, p_idempotency_key, v_complaint.id, v_hash);

  insert into public.ticket_events (complaint_id, event_type, actor_id, actor_kind, actor_role, new_status)
  values (v_complaint.id, 'created', v_actor, 'user', v_role, v_complaint.status);

  return query select v_complaint.id, v_complaint.reference_no, v_complaint.status, true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- transition_ticket: status changes allowed by private.ticket_transitions
-- ---------------------------------------------------------------------------------------------
create function public.transition_ticket(
  p_ticket_id uuid,
  p_target public.ticket_state,
  p_expected_version integer,
  p_note text default null
)
returns table (id uuid, status public.ticket_state, version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_ticket public.complaints%rowtype;
  v_previous public.ticket_state;
  v_note text;
begin
  v_role := private.require_actor_role(v_actor);
  v_ticket := private.lock_visible_ticket(p_ticket_id, v_actor, v_role);
  perform private.require_version(v_ticket, p_expected_version);

  if not exists (select 1 from private.ticket_transitions as t
                  where t.from_state = v_ticket.status and t.to_state = p_target and t.actor_role = v_role) then
    if exists (select 1 from private.ticket_transitions as t
                where t.from_state = v_ticket.status and t.to_state = p_target) then
      raise exception 'your role cannot make this change' using errcode = 'MR403';
    end if;
    raise exception 'status change not allowed from %', v_ticket.status using errcode = 'MR422';
  end if;

  -- Resolving explains the fix; reopening explains what is still wrong.
  v_note := private.normalise_note(p_note, p_target in ('resolved', 'reopened'));
  v_previous := v_ticket.status;

  update public.complaints as c
     set status = p_target, version = c.version + 1
   where c.id = v_ticket.id
  returning * into v_ticket;

  insert into public.ticket_events
    (complaint_id, event_type, actor_id, actor_kind, actor_role, previous_status, new_status, note)
  values
    (v_ticket.id, 'status_changed', v_actor, 'user', v_role, v_previous, p_target, v_note);

  return query select v_ticket.id, v_ticket.status, v_ticket.version;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- acknowledge_ticket: department confirms it has seen the assignment
-- ---------------------------------------------------------------------------------------------
create function public.acknowledge_ticket(p_ticket_id uuid, p_expected_version integer)
returns table (id uuid, version integer, acknowledged_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_ticket public.complaints%rowtype;
begin
  v_role := private.require_actor_role(v_actor);
  if v_role = 'student' then
    raise exception 'only staff can acknowledge tickets' using errcode = 'MR403';
  end if;
  v_ticket := private.lock_visible_ticket(p_ticket_id, v_actor, v_role);
  perform private.require_version(v_ticket, p_expected_version);

  if v_ticket.status not in ('assigned', 'reopened') or v_ticket.acknowledged_at is not null then
    raise exception 'nothing to acknowledge' using errcode = 'MR422';
  end if;

  update public.complaints as c
     set acknowledged_at = now(), version = c.version + 1
   where c.id = v_ticket.id
  returning * into v_ticket;

  insert into public.ticket_events
    (complaint_id, event_type, actor_id, actor_kind, actor_role, previous_status, new_status, department_id)
  values
    (v_ticket.id, 'acknowledged', v_actor, 'user', v_role, v_ticket.status, v_ticket.status,
     v_ticket.assigned_department_id);

  return query select v_ticket.id, v_ticket.version, v_ticket.acknowledged_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- add_ticket_note: work notes from staff; they never change the ticket itself
-- ---------------------------------------------------------------------------------------------
create function public.add_ticket_note(p_ticket_id uuid, p_note text)
returns table (event_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_ticket public.complaints%rowtype;
  v_note text;
  v_event_id bigint;
begin
  v_role := private.require_actor_role(v_actor);
  if v_role = 'student' then
    raise exception 'only staff can add work notes' using errcode = 'MR403';
  end if;
  v_ticket := private.lock_visible_ticket(p_ticket_id, v_actor, v_role);

  if v_ticket.status = 'closed' then
    raise exception 'closed tickets cannot be changed' using errcode = 'MR422';
  end if;

  v_note := private.normalise_note(p_note, true);

  insert into public.ticket_events
    (complaint_id, event_type, actor_id, actor_kind, actor_role, previous_status, new_status, note)
  values
    (v_ticket.id, 'note_added', v_actor, 'user', v_role, v_ticket.status, v_ticket.status, v_note)
  returning ticket_events.id into v_event_id;

  return query select v_event_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- assign_ticket: admin classification and (re)assignment (P3.03, P3.07)
-- ---------------------------------------------------------------------------------------------
create function public.assign_ticket(
  p_ticket_id uuid,
  p_department_id uuid,
  p_category public.complaint_category,
  p_priority public.ticket_priority,
  p_expected_version integer,
  p_note text default null
)
returns table (id uuid, status public.ticket_state, version integer, assigned_department_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_ticket public.complaints%rowtype;
  v_previous public.ticket_state;
  v_note text;
begin
  v_role := private.require_actor_role(v_actor);
  if v_role <> 'admin' then
    raise exception 'only administrators can assign tickets' using errcode = 'MR403';
  end if;
  v_ticket := private.lock_visible_ticket(p_ticket_id, v_actor, v_role);
  perform private.require_version(v_ticket, p_expected_version);

  if v_ticket.status not in ('submitted', 'triaging', 'needs_review', 'assigned', 'in_progress', 'reopened') then
    raise exception 'tickets in status % cannot be reassigned', v_ticket.status using errcode = 'MR422';
  end if;
  if p_category is null or p_category = 'unclassified' then
    raise exception 'choose a category' using errcode = '22023';
  end if;
  if p_priority is null or p_priority = 'unassessed' then
    raise exception 'choose a priority' using errcode = '22023';
  end if;
  if not exists (select 1 from public.departments as d where d.id = p_department_id and d.is_active) then
    raise exception 'choose an active department' using errcode = '22023';
  end if;
  if v_ticket.status = 'assigned'
     and v_ticket.assigned_department_id = p_department_id
     and v_ticket.category = p_category
     and v_ticket.priority = p_priority then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  v_note := private.normalise_note(p_note, false);
  v_previous := v_ticket.status;

  update public.complaints as c
     set assigned_department_id = p_department_id,
         category = p_category,
         priority = p_priority,
         status = 'assigned',
         acknowledged_at = null,
         version = c.version + 1
   where c.id = v_ticket.id
  returning * into v_ticket;

  insert into public.ticket_events
    (complaint_id, event_type, actor_id, actor_kind, actor_role, previous_status, new_status,
     department_id, category, priority, note)
  values
    (v_ticket.id, 'assigned', v_actor, 'user', v_role, v_previous, 'assigned',
     p_department_id, p_category, p_priority, v_note);

  return query select v_ticket.id, v_ticket.status, v_ticket.version, v_ticket.assigned_department_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ticket_transition_rules: read-only view of the transition table (UI and drift test)
-- ---------------------------------------------------------------------------------------------
create function public.ticket_transition_rules()
returns table (from_state public.ticket_state, to_state public.ticket_state, actor_role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select t.from_state, t.to_state, t.actor_role
    from private.ticket_transitions as t
   order by t.actor_role, t.from_state, t.to_state;
$$;

-- ---------------------------------------------------------------------------------------------
-- list_complaints: adds sort orders for department queues (P3.04: age and priority)
-- ---------------------------------------------------------------------------------------------
drop function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[]);

create function public.list_complaints(
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_statuses public.ticket_state[] default null,
  p_sort text default 'newest',
  p_cursor_priority public.ticket_priority default null
)
returns setof public.complaints
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 51);
begin
  if p_sort = 'newest' then
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (p_cursor_created_at is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
       order by c.created_at desc, c.id desc
       limit v_limit;
  elsif p_sort = 'oldest' then
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (p_cursor_created_at is null or (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id))
       order by c.created_at asc, c.id asc
       limit v_limit;
  elsif p_sort = 'priority' then
    -- Most urgent first; within a priority, the longest-waiting ticket first.
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (
           p_cursor_created_at is null
           or c.priority < p_cursor_priority
           or (c.priority = p_cursor_priority and (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id))
         )
       order by c.priority desc, c.created_at asc, c.id asc
       limit v_limit;
  else
    raise exception 'unknown sort order' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: exactly these functions are callable by signed-in users
-- ---------------------------------------------------------------------------------------------
revoke all on function public.transition_ticket(uuid, public.ticket_state, integer, text) from public, anon, authenticated;
revoke all on function public.acknowledge_ticket(uuid, integer) from public, anon, authenticated;
revoke all on function public.add_ticket_note(uuid, text) from public, anon, authenticated;
revoke all on function public.assign_ticket(uuid, uuid, public.complaint_category, public.ticket_priority, integer, text)
  from public, anon, authenticated;
revoke all on function public.ticket_transition_rules() from public, anon, authenticated;
revoke all on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority)
  from public, anon, authenticated;

grant execute on function public.transition_ticket(uuid, public.ticket_state, integer, text) to authenticated;
grant execute on function public.acknowledge_ticket(uuid, integer) to authenticated;
grant execute on function public.add_ticket_note(uuid, text) to authenticated;
grant execute on function public.assign_ticket(uuid, uuid, public.complaint_category, public.ticket_priority, integer, text)
  to authenticated;
grant execute on function public.ticket_transition_rules() to authenticated;
grant execute on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority)
  to authenticated;
