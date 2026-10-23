-- MakeItRight: complaint persistence (master plan P2.01-P2.03, P2.09; §6, §9, §10).
--
--   * Tickets are created only through public.create_ticket(): one transaction inserts the
--     complaint, its idempotency key and the CREATED event, with the owner taken from auth.uid().
--   * Nobody can INSERT, UPDATE or DELETE complaints or events directly. Later phases add
--     audited, role-checking functions for status changes and routing.
--   * ticket_events is append-only: an UPDATE is rejected for every role, even the owner.
--   * Read access: students see their own tickets, department staff see tickets assigned to
--     their department, admins see all. Events are visible exactly when their ticket is.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.ticket_state as enum (
  'submitted', 'triaging', 'needs_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed'
);

create type public.ticket_priority as enum ('unassessed', 'low', 'medium', 'high');

-- The six MVP categories (plan §1) plus the state before classification.
create type public.complaint_category as enum (
  'unclassified', 'electrical', 'it_equipment', 'plumbing', 'furniture', 'sanitation', 'other'
);

create type public.ticket_event_type as enum ('created');

-- Who caused an event. 'agent' and 'rule' arrive with automated routing in Phase 4.
create type public.ticket_actor_kind as enum ('user', 'agent', 'rule', 'system');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  -- Short, human-friendly reference shown as MIR-1001; the uuid stays the real identifier.
  reference_no integer generated always as identity (start with 1001) unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  title text not null constraint complaints_title_length
    check (char_length(btrim(title)) between 5 and 120),
  description text not null constraint complaints_description_length
    check (char_length(btrim(description)) between 15 and 3000),
  building text not null constraint complaints_building_length
    check (char_length(btrim(building)) between 2 and 80),
  room text constraint complaints_room_length
    check (room is null or char_length(btrim(room)) between 1 and 40),
  category public.complaint_category not null default 'unclassified',
  priority public.ticket_priority not null default 'unassessed',
  status public.ticket_state not null default 'submitted',
  assigned_department_id uuid references public.departments (id) on delete restrict,
  version integer not null default 1 constraint complaints_version_positive check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.complaints is
  'Facilities tickets. Written only by audited functions; status/assignment changes append ticket_events.';

-- Keyset pagination: newest first, id breaks ties (plan §11).
create index complaints_owner_recent_idx on public.complaints (created_by, created_at desc, id desc);
create index complaints_department_queue_idx
  on public.complaints (assigned_department_id, status, created_at desc)
  where assigned_department_id is not null;
create index complaints_recent_idx on public.complaints (created_at desc, id desc);

create table public.ticket_events (
  id bigint generated always as identity primary key,
  -- Cascade only matters for maintenance cleanup by the service role; no app role can delete.
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  event_type public.ticket_event_type not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind public.ticket_actor_kind not null,
  previous_status public.ticket_state,
  new_status public.ticket_state,
  note text constraint ticket_events_note_length check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  constraint ticket_events_user_has_actor check (actor_kind <> 'user' or actor_id is not null)
);

comment on table public.ticket_events is 'Append-only audit timeline for each complaint.';

create index ticket_events_complaint_idx on public.ticket_events (complaint_id, created_at, id);

create table public.submission_keys (
  actor_id uuid not null references public.profiles (id) on delete cascade,
  idempotency_key uuid not null,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  -- SHA-256 of the submitted content: a reused key with different content is refused.
  request_hash text not null constraint submission_keys_hash_format check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

comment on table public.submission_keys is 'Idempotency guard for ticket creation (BR-08).';

create index submission_keys_complaint_idx on public.submission_keys (complaint_id);

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------
create trigger complaints_touch_updated_at
  before update on public.complaints
  for each row execute function private.touch_updated_at();

create function private.reject_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ticket_events is append-only'
    using errcode = '42501', hint = 'Append a new event instead of changing history.';
end;
$$;

revoke all on function private.reject_event_update() from public, anon, authenticated;

create trigger ticket_events_append_only
  before update on public.ticket_events
  for each row execute function private.reject_event_update();

-- ---------------------------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------------------------
alter table public.complaints enable row level security;
alter table public.ticket_events enable row level security;
alter table public.submission_keys enable row level security;

revoke all on table public.complaints, public.ticket_events, public.submission_keys
  from anon, authenticated;

grant select on table public.complaints to authenticated;
grant select on table public.ticket_events to authenticated;
-- submission_keys: no grants at all; only create_ticket (as owner) touches it.

create policy complaints_select_scoped
  on public.complaints for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or (select private.current_app_role()) = 'admin'
    or (
      (select private.current_app_role()) = 'department'
      and assigned_department_id = (select private.current_department_id())
    )
  );

-- Evaluated as the caller, so the complaints policy above decides event visibility too.
create policy ticket_events_select_with_complaint
  on public.ticket_events for select
  to authenticated
  using (exists (select 1 from public.complaints as c where c.id = complaint_id));

-- ---------------------------------------------------------------------------------------------
-- create_ticket: the only way to create a complaint
-- ---------------------------------------------------------------------------------------------
-- Error codes surfaced to the server (mapped to HTTP statuses in the app):
--   42501 not signed in / no profile      MR429 too many submissions (durable SQL guard)
--   MR409 idempotency key reused with different content
--   23514 field limits (check constraints are the last line of defence behind Zod)
create function public.create_ticket(
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
  v_title text := btrim(p_title);
  v_description text := btrim(p_description);
  v_building text := btrim(p_building);
  v_room text := nullif(btrim(p_room), '');
  v_hash text;
  v_existing record;
  v_complaint public.complaints%rowtype;
begin
  if v_actor is null or not exists (select 1 from public.profiles as p where p.id = v_actor) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22004';
  end if;

  v_hash := encode(
    sha256(convert_to(jsonb_build_array(v_title, v_description, v_building, v_room)::text, 'UTF8')),
    'hex'
  );

  -- Serialise all ticket creation by this user. One per-user lock makes both checks below
  -- race-free: a concurrent retry of the same key sees the committed key, and concurrent new
  -- submissions see each other's rows when counting towards the rate limit. Released at commit.
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

  -- Durable rate limit (plan §11): a retry with an existing key above never counts.
  if (select count(*) from public.complaints as c
       where c.created_by = v_actor and c.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'too many submissions' using errcode = 'MR429';
  end if;

  insert into public.complaints (created_by, title, description, building, room)
  values (v_actor, v_title, v_description, v_building, v_room)
  returning * into v_complaint;

  insert into public.submission_keys (actor_id, idempotency_key, complaint_id, request_hash)
  values (v_actor, p_idempotency_key, v_complaint.id, v_hash);

  insert into public.ticket_events (complaint_id, event_type, actor_id, actor_kind, new_status)
  values (v_complaint.id, 'created', v_actor, 'user', v_complaint.status);

  return query select v_complaint.id, v_complaint.reference_no, v_complaint.status, true;
end;
$$;

revoke all on function public.create_ticket(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_ticket(text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- list_complaints: keyset-paginated, RLS-scoped listing (SECURITY INVOKER)
-- ---------------------------------------------------------------------------------------------
-- Runs with the caller's privileges, so it returns exactly the rows the caller may see.
-- No filter strings are assembled from user input anywhere.
create function public.list_complaints(
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_statuses public.ticket_state[] default null
)
returns setof public.complaints
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from public.complaints as c
   where (p_statuses is null or c.status = any (p_statuses))
     and (
       p_cursor_created_at is null
       or (c.created_at, c.id) < (p_cursor_created_at, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     )
   order by c.created_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 51);
$$;

revoke all on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[])
  from public, anon, authenticated;
grant execute on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[])
  to authenticated;
