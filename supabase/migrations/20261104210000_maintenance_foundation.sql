-- MakeItRight add-on A0: maintenance foundation (Advanced Features plan v2 §03, §04 M1, M2, the
-- photo metadata of M3, the ai_jobs table of M5, and M6; tasks A0.03-A0.05).
--
--   * Additive only. No existing table, column, function, policy or route changes.
--   * A complaint stays the reporter's record. A maintenance case is the operational record of
--     one real-world issue, and case_reports links complaints to it (at most one case each).
--   * Until duplicate linking exists (A3), every case holds exactly one report and mirrors that
--     ticket: triggers on complaints open the case and copy its status, assignment, category and
--     priority, with an append-only case event, inside the ticket's own transaction. The audited
--     ticket functions therefore stay the only way a status changes, so there is one source of
--     status truth.
--   * Nobody writes the new tables through the Data API. Reads are scoped by RLS: admins see
--     everything, department staff see their department's cases, and students see none of the
--     operational records (their complaint remains their view).
--   * Rollback: switch the feature flags off and redeploy the previous app. Nothing reads these
--     tables while the flags are off; never drop them as an emergency step (plan §16).

-- ---------------------------------------------------------------------------------------------
-- Extensions (M1). Used from A1 (pgmq) and A3 (pgvector); enabled now so every environment is
-- proven to support them before any feature depends on them.
-- ---------------------------------------------------------------------------------------------
create extension if not exists vector with schema extensions;
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.maintenance_case_status as enum (
  'open', 'needs_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed'
);

create type public.case_event_type as enum ('opened', 'assigned', 'status_changed', 'updated');

create type public.attachment_state as enum ('pending', 'finalized', 'rejected');

create type public.ai_job_type as enum (
  'visual_analysis', 'embedding', 'duplicate_match', 'coordination', 'repair_verify', 'insights_refresh'
);

create type public.ai_job_status as enum ('queued', 'running', 'succeeded', 'retry_wait', 'needs_review');

-- ---------------------------------------------------------------------------------------------
-- Campus reference data: rooms and equipment (no QR codes, plan §01)
-- ---------------------------------------------------------------------------------------------
create table public.maintenance_locations (
  id uuid primary key default gen_random_uuid(),
  -- Codes are stored normalised (upper case, checked), so the unique tuple below is normalised.
  building_code text not null constraint maintenance_locations_building_code_format
    check (building_code ~ '^[A-Z][A-Z0-9]{1,9}$'),
  building_name text not null constraint maintenance_locations_building_name_length
    check (char_length(btrim(building_name)) between 2 and 80),
  floor smallint not null constraint maintenance_locations_floor_range check (floor between -5 and 50),
  room_code text not null constraint maintenance_locations_room_code_format
    check (room_code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  display_name text not null constraint maintenance_locations_display_name_length
    check (char_length(btrim(display_name)) between 2 and 120),
  -- Hotspot centre on the floor plan, in a 0-1000 coordinate space (F5).
  map_x smallint constraint maintenance_locations_map_x_range check (map_x between 0 and 1000),
  map_y smallint constraint maintenance_locations_map_y_range check (map_y between 0 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint maintenance_locations_room_unique unique (building_code, floor, room_code),
  constraint maintenance_locations_map_point check ((map_x is null) = (map_y is null))
);

comment on table public.maintenance_locations is
  'Normalised campus rooms (plan v2 §04). Cases point here; a null location means UNKNOWN.';

create table public.asset_registry (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.maintenance_locations (id) on delete restrict,
  -- Administrator-maintained identifier, e.g. PRJ-ENG-204. Not a QR code.
  asset_code text not null unique constraint asset_registry_code_format
    check (asset_code ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' and char_length(asset_code) <= 32),
  asset_type text not null constraint asset_registry_type_format check (asset_type ~ '^[a-z][a-z_]{1,31}$'),
  label text not null constraint asset_registry_label_length check (char_length(btrim(label)) between 2 and 80),
  serial_number text constraint asset_registry_serial_length
    check (serial_number is null or char_length(btrim(serial_number)) between 1 and 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Lets a case reference (asset, location) as a pair, so an asset is always in the case's room.
  constraint asset_registry_id_location_key unique (id, location_id)
);

comment on table public.asset_registry is 'Equipment with stable identities and a fixed room (F6).';

create index asset_registry_location_idx on public.asset_registry (location_id);

-- ---------------------------------------------------------------------------------------------
-- Maintenance cases (M2)
-- ---------------------------------------------------------------------------------------------
create table public.maintenance_cases (
  id uuid primary key default gen_random_uuid(),
  reference_no integer generated always as identity (start with 5001) unique,
  location_id uuid references public.maintenance_locations (id) on delete restrict,
  asset_id uuid,
  category public.complaint_category not null default 'unclassified',
  priority public.ticket_priority not null default 'unassessed',
  status public.maintenance_case_status not null default 'open',
  assigned_department_id uuid references public.departments (id) on delete restrict,
  version integer not null default 1 constraint maintenance_cases_version_positive check (version > 0),
  -- Labelled demo history (A0.05); never mixed up with cases opened by real reports.
  is_synthetic boolean not null default false,
  opened_at timestamptz not null default now(),
  -- The latest resolution; cleared when the case reopens.
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_cases_asset_in_location
    foreign key (asset_id, location_id) references public.asset_registry (id, location_id) on delete restrict,
  constraint maintenance_cases_asset_needs_location check (asset_id is null or location_id is not null),
  constraint maintenance_cases_closed_at_matches_status check ((status = 'closed') = (closed_at is not null)),
  constraint maintenance_cases_resolved_after_open check (resolved_at is null or resolved_at >= opened_at),
  constraint maintenance_cases_closed_after_open check (closed_at is null or closed_at >= opened_at)
);

comment on table public.maintenance_cases is
  'One real-world repair issue; may represent several complaints. Written only by controlled functions.';

create index maintenance_cases_location_idx on public.maintenance_cases (location_id, status, opened_at desc);
create index maintenance_cases_asset_idx on public.maintenance_cases (asset_id, opened_at desc)
  where asset_id is not null;
create index maintenance_cases_department_idx on public.maintenance_cases (assigned_department_id, status)
  where assigned_department_id is not null;

create table public.case_reports (
  -- The primary key makes "a complaint belongs to at most one case" structural.
  complaint_id uuid primary key references public.complaints (id) on delete cascade,
  case_id uuid not null references public.maintenance_cases (id) on delete restrict,
  -- Null when the system linked it (a new report opens its own case).
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now()
);

comment on table public.case_reports is
  'Links student complaints to a maintenance case. Linking never changes or deletes the complaint.';

create index case_reports_case_idx on public.case_reports (case_id);

create table public.case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  event_type public.case_event_type not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind public.ticket_actor_kind not null,
  previous_status public.maintenance_case_status,
  new_status public.maintenance_case_status,
  department_id uuid references public.departments (id) on delete set null,
  -- The report whose ticket change caused this event, if any.
  complaint_id uuid references public.complaints (id) on delete cascade,
  note text constraint case_events_note_length check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  constraint case_events_user_has_actor check (actor_kind <> 'user' or actor_id is not null)
);

comment on table public.case_events is 'Append-only audit timeline for each maintenance case.';

create index case_events_case_idx on public.case_events (case_id, created_at, id);
create index case_events_complaint_idx on public.case_events (complaint_id) where complaint_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Photo and evidence metadata (M3). Files live in a private Storage bucket from A1; this row is
-- the only reference to an object, and a complaint never depends on it.
-- ---------------------------------------------------------------------------------------------
create table public.evidence_attachments (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one parent: a reporter's photo belongs to a complaint, repair evidence to a case.
  complaint_id uuid references public.complaints (id) on delete cascade,
  case_id uuid references public.maintenance_cases (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  bucket text not null default 'complaint-evidence'
    constraint evidence_attachments_bucket check (bucket = 'complaint-evidence'),
  -- <uploader id>/<attachment id>.<ext>: the first folder lets Storage policies check ownership.
  object_path text not null unique constraint evidence_attachments_object_path_format
    check (object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  mime_type text not null constraint evidence_attachments_mime_allowlist
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  -- 2 MB cap (2 MiB), plan F1.01.
  byte_size integer not null constraint evidence_attachments_byte_size_range check (byte_size between 1 and 2097152),
  sha256 text constraint evidence_attachments_sha256_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  state public.attachment_state not null default 'pending',
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint evidence_attachments_one_parent check (num_nonnulls(complaint_id, case_id) = 1),
  constraint evidence_attachments_finalized_at_matches_state
    check ((state = 'finalized') = (finalized_at is not null))
);

comment on table public.evidence_attachments is
  'Private photo metadata (plan v2 F1/F4). The image bytes are in Storage, never in the database.';

create index evidence_attachments_complaint_idx on public.evidence_attachments (complaint_id)
  where complaint_id is not null;
create index evidence_attachments_case_idx on public.evidence_attachments (case_id) where case_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Durable AI job records (M5). The pgmq queue and its consumer arrive in A1.
-- ---------------------------------------------------------------------------------------------
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type public.ai_job_type not null,
  -- The complaint, case or attachment the job works on; the type says which.
  target_id uuid not null,
  -- Repeated enqueues of the same work collapse onto one job (plan §05).
  dedupe_key text not null unique constraint ai_jobs_dedupe_key_format
    check (char_length(dedupe_key) between 8 and 200 and dedupe_key !~ '[[:space:][:cntrl:]]'),
  status public.ai_job_status not null default 'queued',
  attempts smallint not null default 0 constraint ai_jobs_attempts_range check (attempts between 0 and 10),
  next_retry_at timestamptz,
  last_error_code text constraint ai_jobs_error_code_format
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_jobs_retry_time_matches_status check ((status = 'retry_wait') = (next_retry_at is not null))
);

comment on table public.ai_jobs is
  'One row per unit of background AI work. Queue messages carry only the job id (plan §05).';

create index ai_jobs_status_idx on public.ai_jobs (status, next_retry_at);
create index ai_jobs_target_idx on public.ai_jobs (job_type, target_id);

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------
create trigger maintenance_cases_touch_updated_at
  before update on public.maintenance_cases
  for each row execute function private.touch_updated_at();

create trigger ai_jobs_touch_updated_at
  before update on public.ai_jobs
  for each row execute function private.touch_updated_at();

create function private.reject_history_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '42501', hint = 'Append a new event instead of changing history.';
end;
$$;

revoke all on function private.reject_history_update() from public, anon, authenticated;

create trigger case_events_append_only
  before update on public.case_events
  for each row execute function private.reject_history_update();

-- ---------------------------------------------------------------------------------------------
-- Case helpers: one ticket mirrored into one case (until A3 links several reports)
-- ---------------------------------------------------------------------------------------------
create function private.case_status_for_ticket(p_status public.ticket_state)
returns public.maintenance_case_status
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'submitted' then 'open'
    when 'triaging' then 'open'
    when 'needs_review' then 'needs_review'
    when 'assigned' then 'assigned'
    when 'in_progress' then 'in_progress'
    when 'resolved' then 'resolved'
    when 'reopened' then 'reopened'
    when 'closed' then 'closed'
  end::public.maintenance_case_status;
$$;

-- Maps a report's free-text building and room to a known location. Matches the building code or
-- name and the room code, ignoring case and outer spaces. Anything unmatched or ambiguous is
-- UNKNOWN (null): a wrong room is worse than an unknown one on the heatmap.
create function private.match_location(p_building text, p_room text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(l.id))[1] end
    from public.maintenance_locations as l
   where l.is_active
     and (l.building_code = upper(btrim(p_building)) or lower(l.building_name) = lower(btrim(p_building)))
     and l.room_code = upper(btrim(coalesce(p_room, '')));
$$;

create function private.open_case_for_complaint(p_complaint public.complaints, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.maintenance_case_status := private.case_status_for_ticket(p_complaint.status);
  v_case_id uuid;
begin
  insert into public.maintenance_cases
    (location_id, category, priority, status, assigned_department_id, opened_at, resolved_at, closed_at)
  values (
    private.match_location(p_complaint.building, p_complaint.room),
    p_complaint.category,
    p_complaint.priority,
    v_status,
    p_complaint.assigned_department_id,
    p_complaint.created_at,
    case when v_status = 'resolved' then
      (select max(e.created_at) from public.ticket_events as e
        where e.complaint_id = p_complaint.id and e.new_status = 'resolved')
    end,
    case when v_status = 'closed' then now() end
  )
  returning id into v_case_id;

  insert into public.case_reports (complaint_id, case_id) values (p_complaint.id, v_case_id);

  insert into public.case_events (case_id, event_type, actor_kind, new_status, department_id, complaint_id, note)
  values (v_case_id, 'opened', 'system', v_status, p_complaint.assigned_department_id, p_complaint.id, p_note);

  return v_case_id;
end;
$$;

revoke all on function private.case_status_for_ticket(public.ticket_state) from public, anon, authenticated;
revoke all on function private.match_location(text, text) from public, anon, authenticated;
revoke all on function private.open_case_for_complaint(public.complaints, text) from public, anon, authenticated;

create function private.open_case_for_new_complaint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.open_case_for_complaint(new, 'Opened for a new report.');
  return null;
end;
$$;

-- Copies a ticket change onto its single-report case, with one case event. Runs in the same
-- transaction as the audited ticket function that made the change, so the two never disagree.
create function private.mirror_ticket_to_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.maintenance_cases;
  v_status public.maintenance_case_status := private.case_status_for_ticket(new.status);
begin
  select mc.* into v_case
    from public.case_reports as cr
    join public.maintenance_cases as mc on mc.id = cr.case_id
   where cr.complaint_id = new.id
     for update of mc;

  if not found then
    -- A ticket closed before A0 was never backfilled; if it becomes active again, it needs a case.
    if new.status <> 'closed' then
      perform private.open_case_for_complaint(new, 'Opened when an older ticket became active again.');
    end if;
    return null;
  end if;

  -- A case that represents several reports follows its own workflow (A3+), not one ticket.
  if (select count(*) from public.case_reports as cr where cr.case_id = v_case.id) > 1 then
    return null;
  end if;

  if (v_case.status, v_case.category, v_case.priority, v_case.assigned_department_id)
     is not distinct from (v_status, new.category, new.priority, new.assigned_department_id) then
    return null;
  end if;

  update public.maintenance_cases as mc
     set status = v_status,
         category = new.category,
         priority = new.priority,
         assigned_department_id = new.assigned_department_id,
         resolved_at = case
           when v_status = 'resolved' and v_case.status <> 'resolved' then now()
           when v_status = 'reopened' then null
           else mc.resolved_at
         end,
         closed_at = case when v_status = 'closed' then coalesce(mc.closed_at, now()) end,
         version = mc.version + 1
   where mc.id = v_case.id;

  insert into public.case_events
    (case_id, event_type, actor_kind, previous_status, new_status, department_id, complaint_id)
  values (
    v_case.id,
    case
      when new.assigned_department_id is distinct from v_case.assigned_department_id then 'assigned'
      when v_status <> v_case.status then 'status_changed'
      else 'updated'
    end::public.case_event_type,
    'system',
    v_case.status,
    v_status,
    new.assigned_department_id,
    new.id
  );

  return null;
end;
$$;

-- Maintenance cleanup (service role only) may delete a complaint; its now-empty case goes too.
create function private.remove_empty_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.maintenance_cases as mc
   where mc.id = old.case_id
     and not mc.is_synthetic
     and not exists (select 1 from public.case_reports as cr where cr.case_id = old.case_id);
  return null;
end;
$$;

revoke all on function private.open_case_for_new_complaint() from public, anon, authenticated;
revoke all on function private.mirror_ticket_to_case() from public, anon, authenticated;
revoke all on function private.remove_empty_case() from public, anon, authenticated;

-- Created before the backfill: creating a trigger locks complaints against concurrent writes
-- until this migration commits, so no ticket can slip between the backfill and the triggers.
create trigger complaints_open_case
  after insert on public.complaints
  for each row execute function private.open_case_for_new_complaint();

create trigger complaints_mirror_to_case
  after update of status, category, priority, assigned_department_id on public.complaints
  for each row execute function private.mirror_ticket_to_case();

create trigger case_reports_remove_empty_case
  after delete on public.case_reports
  for each row execute function private.remove_empty_case();

-- Backfill (M2): one case per existing open complaint, oldest first.
do $$
declare
  v_complaint public.complaints;
begin
  for v_complaint in
    select c.* from public.complaints as c
     where c.status <> 'closed'
       and not exists (select 1 from public.case_reports as cr where cr.complaint_id = c.id)
     order by c.created_at, c.id
  loop
    perform private.open_case_for_complaint(v_complaint, 'Backfilled from an existing open ticket.');
  end loop;
end;
$$;

-- Cases backfilled before the campus existed have an UNKNOWN location. Once locations are
-- added (seed.sql), this matches each single-report case to its report's building and room,
-- with an audit event. Shared cases and cases already located are left alone.
create function private.locate_unknown_cases()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with located as (
    update public.maintenance_cases as mc
       set location_id = private.match_location(c.building, c.room),
           version = mc.version + 1
      from public.case_reports as cr
      join public.complaints as c on c.id = cr.complaint_id
     where cr.case_id = mc.id
       and mc.location_id is null
       and not mc.is_synthetic
       and private.match_location(c.building, c.room) is not null
       and (select count(*) from public.case_reports as other where other.case_id = mc.id) = 1
    returning mc.id, mc.status, c.id as complaint_id
  ),
  logged as (
    insert into public.case_events (case_id, event_type, actor_kind, previous_status, new_status, complaint_id, note)
    select l.id, 'updated', 'system', l.status, l.status, l.complaint_id, 'Location matched from the report.'
      from located as l
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

revoke all on function private.locate_unknown_cases() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Synthetic campus history (A0.05). Replaces every synthetic case with the same 60-case
-- scenario set, relative to now(), so the demo can be reset at any time. Cases opened by real
-- reports are never touched. Requires the campus reference data from seed.sql.
--
-- Scenarios inside the last 30 days (case numbers in the list below):
--   1-3  projector PRJ-ENG-204 fails three times (repeat failure)
--   4    a similarly named projector in the next lab (distinct asset, hard negative)
--   7    a sink that reopened 3 days after it was resolved (recent reopen)
--   10   an AC unit in progress for 21 days (long unresolved)
--   1-6  six cases in the Engineering Block (building cluster); Science has 3, Library 2
--   12   a report whose room is unknown
-- The other 48 cases are closed history from 35 to 88 days ago.
-- ---------------------------------------------------------------------------------------------
create function private.reset_synthetic_campus_history()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_spec record;
  v_case_id uuid;
  v_location_id uuid;
  v_asset_id uuid;
  v_department_id uuid;
  v_status public.maintenance_case_status;
  v_count integer := 0;
  v_note constant text := 'Synthetic demo history.';
begin
  if not exists (select 1 from public.maintenance_locations) then
    raise exception 'campus reference data is missing; apply supabase/seed.sql first'
      using errcode = '55000';
  end if;

  delete from public.maintenance_cases where is_synthetic;

  for v_spec in
    with scenario (n, building_code, room_code, asset_code, category, priority,
                   opened_d, assigned_d, started_d, resolved_d, reopened_d, closed_d, held) as (
      values
        (1, 'ENG', 'LAB-204', 'PRJ-ENG-204', 'it_equipment', 'medium', 26.0, 25.9, 25.0, 24.5, null, 24.0, false),
        (2, 'ENG', 'LAB-204', 'PRJ-ENG-204', 'it_equipment', 'medium', 15.0, 14.9, 14.0, 12.5, null, 12.0, false),
        (3, 'ENG', 'LAB-204', 'PRJ-ENG-204', 'it_equipment', 'high', 4.0, 3.9, 3.0, null, null, null, false),
        (4, 'ENG', 'LAB-203', 'PRJ-ENG-203', 'it_equipment', 'low', 10.0, 9.9, 9.5, 9.0, null, 8.5, false),
        (5, 'ENG', 'WC-105', 'SNK-ENG-105', 'plumbing', 'medium', 8.0, 7.9, 7.5, 7.0, null, 6.5, false),
        (6, 'ENG', 'CR-101', 'DSK-ENG-101', 'furniture', 'low', 3.0, null, null, null, null, null, false),
        (7, 'SCI', 'WC-205', 'SNK-SCI-205', 'plumbing', 'medium', 12.0, 11.9, 11.0, 9.0, 6.0, null, false),
        (8, 'SCI', 'LAB-204', 'PC-SCI-204', 'it_equipment', 'medium', 2.0, null, null, null, null, null, true),
        (9, 'SCI', 'LAB-103', 'ACU-SCI-103', 'electrical', 'medium', 18.0, 17.9, 17.0, 16.0, null, 15.5, false),
        (10, 'LIB', 'CR-101', 'ACU-LIB-101', 'electrical', 'high', 21.0, 20.9, 20.0, null, null, null, false),
        (11, 'LIB', 'CR-201', 'LGT-LIB-201', 'electrical', 'medium', 5.0, 4.9, null, null, null, null, false),
        (12, null, null, null, 'other', 'low', 1.0, null, null, null, null, null, false)
    ),
    background as (
      -- Spread over buildings, floors and rooms; the category suits the room type.
      select 12 + i as n,
             (array['ENG', 'SCI', 'LIB'])[1 + i % 3] as building_code,
             (array['CR', 'CR', 'LAB', 'LAB', 'WC', 'OFF'])[1 + (i / 6) % 6]
               || '-' || (1 + (i / 3) % 2) || '0' || (1 + (i / 6) % 6) as room_code,
             null::text as asset_code,
             (array[array['furniture', 'electrical'], array['furniture', 'electrical'],
                    array['it_equipment', 'electrical'], array['it_equipment', 'electrical'],
                    array['plumbing', 'sanitation'], array['other', 'electrical']])
               [1 + (i / 6) % 6][1 + i % 2] as category,
             (array['low', 'medium', 'medium', 'high'])[1 + i % 4] as priority,
             (35 + (i * 53) % 54)::numeric as opened_d
        from generate_series(1, 48) as i
    )
    select n, building_code, room_code, asset_code, category, priority,
           opened_d, assigned_d, started_d, resolved_d, reopened_d, closed_d, held
      from scenario
    union all
    select n, building_code, room_code, asset_code, category, priority,
           opened_d, opened_d - 0.1, opened_d - 1, opened_d - 2.5 - (n % 3), null, opened_d - 3 - (n % 3), false
      from background
    order by n
  loop
    v_location_id := null;
    v_asset_id := null;
    if v_spec.building_code is not null then
      select l.id into strict v_location_id
        from public.maintenance_locations as l
       where l.building_code = v_spec.building_code and l.room_code = v_spec.room_code;
    end if;
    if v_spec.asset_code is not null then
      select a.id into strict v_asset_id from public.asset_registry as a where a.asset_code = v_spec.asset_code;
    end if;

    v_department_id := null;
    if v_spec.assigned_d is not null then
      select r.department_id into strict v_department_id
        from public.routing_rules as r
       where r.category = v_spec.category::public.complaint_category;
    end if;

    v_status := case
      when v_spec.closed_d is not null then 'closed'
      when v_spec.reopened_d is not null then 'reopened'
      when v_spec.resolved_d is not null then 'resolved'
      when v_spec.started_d is not null then 'in_progress'
      when v_spec.assigned_d is not null then 'assigned'
      when v_spec.held then 'needs_review'
      else 'open'
    end;

    insert into public.maintenance_cases
      (location_id, asset_id, category, priority, status, assigned_department_id, is_synthetic,
       opened_at, resolved_at, closed_at, created_at)
    values (
      v_location_id, v_asset_id, v_spec.category::public.complaint_category,
      v_spec.priority::public.ticket_priority, v_status, v_department_id, true,
      now() - v_spec.opened_d * interval '1 day',
      case when v_spec.reopened_d is null then now() - v_spec.resolved_d * interval '1 day' end,
      now() - v_spec.closed_d * interval '1 day',
      now() - v_spec.opened_d * interval '1 day'
    )
    returning id into v_case_id;

    insert into public.case_events (case_id, event_type, actor_kind, previous_status, new_status, department_id, note, created_at)
    select v_case_id, step.event_type::public.case_event_type, 'system',
           step.previous_status::public.maintenance_case_status, step.new_status::public.maintenance_case_status,
           case when step.event_type = 'opened' then null else v_department_id end,
           v_note, now() - step.days_ago * interval '1 day'
      from (values
        (1, 'opened', null, case when v_spec.held then 'needs_review' else 'open' end, v_spec.opened_d),
        (2, 'assigned', 'open', 'assigned', v_spec.assigned_d),
        (3, 'status_changed', 'assigned', 'in_progress', v_spec.started_d),
        (4, 'status_changed', 'in_progress', 'resolved', v_spec.resolved_d),
        (5, 'status_changed', 'resolved', 'reopened', v_spec.reopened_d),
        (6, 'status_changed', 'resolved', 'closed', v_spec.closed_d)
      ) as step (seq, event_type, previous_status, new_status, days_ago)
     where step.days_ago is not null
     order by step.seq;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.reset_synthetic_campus_history() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row-level security and privileges (M6). Select only; every write is a controlled function.
-- ---------------------------------------------------------------------------------------------
alter table public.maintenance_locations enable row level security;
alter table public.asset_registry enable row level security;
alter table public.maintenance_cases enable row level security;
alter table public.case_reports enable row level security;
alter table public.case_events enable row level security;
alter table public.evidence_attachments enable row level security;
alter table public.ai_jobs enable row level security;

revoke all on table public.maintenance_locations, public.asset_registry, public.maintenance_cases,
  public.case_reports, public.case_events, public.evidence_attachments, public.ai_jobs
  from anon, authenticated;

-- Room and equipment names are not sensitive; signed-in users may read them (like departments).
grant select on table public.maintenance_locations, public.asset_registry to authenticated;

create policy maintenance_locations_select_authenticated
  on public.maintenance_locations for select
  to authenticated
  using (true);

create policy asset_registry_select_authenticated
  on public.asset_registry for select
  to authenticated
  using (true);

grant select on table public.maintenance_cases, public.case_reports, public.case_events,
  public.evidence_attachments, public.ai_jobs to authenticated;

-- Admins see every case; department staff see the cases assigned to their department.
-- current_department_id() is null for everyone else, so students see none.
create policy maintenance_cases_select_scoped
  on public.maintenance_cases for select
  to authenticated
  using (
    (select private.current_app_role()) = 'admin'
    or assigned_department_id = (select private.current_department_id())
  );

-- Links and history are visible exactly when their case is.
create policy case_reports_select_with_case
  on public.case_reports for select
  to authenticated
  using (exists (select 1 from public.maintenance_cases as mc where mc.id = case_id));

create policy case_events_select_with_case
  on public.case_events for select
  to authenticated
  using (exists (select 1 from public.maintenance_cases as mc where mc.id = case_id));

-- A photo is visible exactly when its complaint or case is.
create policy evidence_attachments_select_with_parent
  on public.evidence_attachments for select
  to authenticated
  using (
    exists (select 1 from public.complaints as c where c.id = complaint_id)
    or exists (select 1 from public.maintenance_cases as mc where mc.id = case_id)
  );

-- Job records may name failure codes; only administrators inspect them (A1.04).
create policy ai_jobs_select_admin
  on public.ai_jobs for select
  to authenticated
  using ((select private.current_app_role()) = 'admin');
