-- MakeItRight add-on A3: semantic duplicate detection and shared cases (Advanced Features plan v2
-- §07, F2.01-F2.05, A3.01-A3.03).
--
--   * complaint_embeddings: one 768-dimension vector per complaint, tagged with its model and a
--     hash of the text it encodes. Vectors of different models are never compared. Internal
--     only: no API role can read them.
--   * match_candidates: ranked suggestions that a new report may describe the same problem as an
--     existing case. Candidates, never facts: only an administrator links reports, one decision
--     per pair, and a rejected pair stays rejected.
--   * Accepting a candidate moves the report into the existing case in one transaction, with a
--     version check, events on both cases and the ticket, and the report's old one-report case
--     kept as "merged". No complaint row is ever deleted or rewritten except its status fields.
--   * From now on a case with several reports leads them (ADR 0008 left this to A3): a staff,
--     admin or agent change on any linked ticket updates the case and every other open ticket
--     in it. A reporter's own confirmation (closing) stays on their ticket; the case closes when
--     every report is closed. A reporter's dispute (reopening) reopens the shared work.

-- ---------------------------------------------------------------------------------------------
-- Embeddings (F2.01)
-- ---------------------------------------------------------------------------------------------
create table public.complaint_embeddings (
  complaint_id uuid primary key references public.complaints (id) on delete cascade,
  model text not null constraint complaint_embeddings_model_format check (model ~ '^[a-z0-9][a-z0-9.-]{1,63}$'),
  dimension smallint not null default 768 constraint complaint_embeddings_dimension check (dimension = 768),
  embedding extensions.vector(768) not null,
  -- SHA-256 of the canonical text that was embedded: unchanged text is never sent again.
  text_hash text not null constraint complaint_embeddings_text_hash_format check (text_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

comment on table public.complaint_embeddings is
  'Semantic vectors of complaint text (plan v2 F2). Internal: compared only within one model.';

create index complaint_embeddings_model_idx on public.complaint_embeddings (model);

alter table public.complaint_embeddings enable row level security;
revoke all on table public.complaint_embeddings from anon, authenticated;
-- No grants and no policies: only service-role functions below touch embeddings.

-- ---------------------------------------------------------------------------------------------
-- Match candidates (F2.03-F2.05)
-- ---------------------------------------------------------------------------------------------
create type public.match_decision as enum ('pending', 'accepted', 'rejected', 'superseded');

create table public.match_candidates (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  candidate_case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  model text not null,
  -- Cosine similarity between this report and the closest report in the candidate case.
  similarity real not null constraint match_candidates_similarity_range check (similarity between -1 and 1),
  -- The ranking score (see supabase/functions/_shared/duplicates/ranking.ts). A ranking aid only.
  score real not null constraint match_candidates_score_range check (score between -1 and 2),
  same_building boolean not null,
  same_room boolean not null,
  category_match boolean not null,
  same_asset boolean not null,
  decision public.match_decision not null default 'pending',
  reviewer_id uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint match_candidates_one_per_pair unique (complaint_id, candidate_case_id),
  constraint match_candidates_decided_at_matches check ((decision = 'pending') = (decided_at is null))
);

comment on table public.match_candidates is
  'Possible duplicates for a person to accept or reject (plan v2 F2). Never applied automatically.';

create index match_candidates_complaint_idx on public.match_candidates (complaint_id, decision);
create index match_candidates_case_idx on public.match_candidates (candidate_case_id);

alter table public.match_candidates enable row level security;
revoke all on table public.match_candidates from anon, authenticated;
grant select on table public.match_candidates to authenticated;

-- Admins, and staff of the department the report is assigned to. Students never see them.
create policy match_candidates_select_staff
  on public.match_candidates for select
  to authenticated
  using (
    (select private.current_app_role()) in ('admin', 'department')
    and exists (select 1 from public.complaints as c where c.id = complaint_id)
  );

alter table public.case_reports
  add column matching_decision_id uuid references public.match_candidates (id) on delete set null;

-- Cases are never deleted by any app role; only maintenance cleanup (service role) removes them,
-- and a case merged into a removed one goes with it.
alter table public.maintenance_cases
  add column merged_into_case_id uuid references public.maintenance_cases (id) on delete cascade,
  add constraint maintenance_cases_merged_has_target check ((status = 'merged') = (merged_into_case_id is not null));

-- ---------------------------------------------------------------------------------------------
-- Shared cases lead their tickets
-- ---------------------------------------------------------------------------------------------
-- The ticket status that matches a case status. An open case keeps a ticket that is still
-- being triaged as it is.
create function private.ticket_status_for_case(
  p_case_status public.maintenance_case_status,
  p_current public.ticket_state
)
returns public.ticket_state
language sql
immutable
set search_path = ''
as $$
  select case p_case_status
    when 'open' then case when p_current in ('submitted', 'triaging') then p_current else 'submitted' end
    when 'needs_review' then 'needs_review'
    when 'assigned' then 'assigned'
    when 'in_progress' then 'in_progress'
    when 'resolved' then 'resolved'
    when 'reopened' then 'reopened'
    when 'closed' then 'closed'
    else p_current
  end::public.ticket_state;
$$;

revoke all on function private.ticket_status_for_case(public.maintenance_case_status, public.ticket_state)
  from public, anon, authenticated;

-- Brings one linked ticket in line with its case, as an audited system event. A ticket its
-- reporter has closed is left alone: closing is the reporter's own confirmation.
create function private.apply_case_to_ticket(
  p_case public.maintenance_cases,
  p_complaint_id uuid,
  p_note text,
  p_event public.ticket_event_type default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.complaints;
  v_status public.ticket_state;
  v_department_changed boolean;
begin
  select c.* into v_ticket from public.complaints as c where c.id = p_complaint_id for update;
  if not found or (v_ticket.status = 'closed' and p_event is null) then
    return;
  end if;

  v_status := case when v_ticket.status = 'closed' then 'closed'
                   else private.ticket_status_for_case(p_case.status, v_ticket.status) end;
  v_department_changed := v_ticket.assigned_department_id is distinct from p_case.assigned_department_id;

  if p_event is null
     and (v_ticket.status, v_ticket.assigned_department_id, v_ticket.category, v_ticket.priority)
         is not distinct from (v_status, p_case.assigned_department_id, p_case.category, p_case.priority) then
    return;
  end if;

  -- The change below must not be mirrored back onto the case it came from.
  perform set_config('makeitright.case_sync', 'on', true);
  update public.complaints as c
     set status = v_status,
         assigned_department_id = p_case.assigned_department_id,
         category = p_case.category,
         priority = p_case.priority,
         acknowledged_at = case when v_department_changed then null else c.acknowledged_at end,
         version = c.version + 1
   where c.id = p_complaint_id;
  perform set_config('makeitright.case_sync', 'off', true);

  insert into public.ticket_events
    (complaint_id, event_type, actor_kind, previous_status, new_status, department_id, category, priority, note)
  values (
    p_complaint_id,
    coalesce(p_event, case when v_department_changed then 'assigned' else 'status_changed' end::public.ticket_event_type),
    'system', v_ticket.status, v_status, p_case.assigned_department_id, p_case.category, p_case.priority, p_note
  );
end;
$$;

revoke all on function private.apply_case_to_ticket(public.maintenance_cases, uuid, text, public.ticket_event_type)
  from public, anon, authenticated;

-- Replaces the A0 version: single-report cases mirror their ticket exactly as before; a shared
-- case is led as described at the top of this file.
create or replace function private.mirror_ticket_to_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.maintenance_cases;
  v_status public.maintenance_case_status := private.case_status_for_ticket(new.status);
  v_reports integer;
  v_role public.app_role;
  v_sibling uuid;
begin
  if current_setting('makeitright.case_sync', true) = 'on' then
    return null;
  end if;

  select mc.* into v_case
    from public.case_reports as cr
    join public.maintenance_cases as mc on mc.id = cr.case_id
   where cr.complaint_id = new.id
     for update of mc;

  if not found then
    if new.status <> 'closed' then
      perform private.open_case_for_complaint(new, 'Opened when an older ticket became active again.');
    end if;
    return null;
  end if;

  select count(*) into v_reports from public.case_reports as cr where cr.case_id = v_case.id;

  if v_reports > 1 then
    v_role := (select private.current_app_role());
    if v_role = 'student' and new.status = 'closed' then
      -- One reporter confirmed the fix for their own report. The case closes with the last one.
      if not exists (
        select 1 from public.case_reports as cr
          join public.complaints as c on c.id = cr.complaint_id
         where cr.case_id = v_case.id and c.status <> 'closed'
      ) then
        update public.maintenance_cases as mc
           set status = 'closed', closed_at = now(), version = mc.version + 1
         where mc.id = v_case.id;
        insert into public.case_events (case_id, event_type, actor_kind, previous_status, new_status, complaint_id, note)
        values (v_case.id, 'status_changed', 'system', v_case.status, 'closed', new.id, 'Every linked report is closed.');
      end if;
      return null;
    end if;
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
   where mc.id = v_case.id
  returning mc.* into v_case;

  insert into public.case_events
    (case_id, event_type, actor_kind, previous_status, new_status, department_id, complaint_id)
  values (
    v_case.id,
    case
      when new.assigned_department_id is distinct from old.assigned_department_id then 'assigned'
      when new.status is distinct from old.status then 'status_changed'
      else 'updated'
    end::public.case_event_type,
    'system',
    private.case_status_for_ticket(old.status),
    v_status,
    new.assigned_department_id,
    new.id
  );

  if v_reports > 1 then
    for v_sibling in
      select cr.complaint_id from public.case_reports as cr
       where cr.case_id = v_case.id and cr.complaint_id <> new.id
       order by cr.linked_at, cr.complaint_id
    loop
      perform private.apply_case_to_ticket(
        v_case, v_sibling, format('Updated with the shared case MC-%s.', v_case.reference_no));
    end loop;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Functions for signed-in users
-- ---------------------------------------------------------------------------------------------
-- Queues the duplicate check of a report (its embedding first). Called by the app after a
-- submission while duplicate detection is switched on, or by an admin. Idempotent per report.
create function public.request_duplicate_check(p_complaint_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_role public.app_role := (select private.current_app_role());
begin
  select c.created_by into v_owner from public.complaints as c where c.id = p_complaint_id;
  if not found or (v_owner is distinct from (select auth.uid()) and v_role is distinct from 'admin') then
    raise exception 'complaint not found' using errcode = 'MR404';
  end if;
  return private.enqueue_ai_job('embedding', p_complaint_id, 'embedding:' || p_complaint_id::text);
end;
$$;

-- An administrator's decision on one candidate (F2.04, F2.05). Rejecting changes nothing else.
-- Accepting moves the report into the candidate case: the case must still be at the version
-- the admin saw (MR412 otherwise), still open, and the report must not already share a case.
create function public.review_match_candidate(
  p_candidate_id uuid,
  p_decision public.match_decision,
  p_expected_case_version integer
)
returns table (candidate_id uuid, decision public.match_decision, case_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_candidate public.match_candidates;
  v_target public.maintenance_cases;
  v_old public.maintenance_cases;
  v_ticket public.complaints;
  v_sibling uuid;
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'admins only' using errcode = 'MR403';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'rejected') then
    raise exception 'decide accepted or rejected' using errcode = '22023';
  end if;

  select m.* into v_candidate from public.match_candidates as m where m.id = p_candidate_id for update;
  if not found then
    raise exception 'candidate not found' using errcode = 'MR404';
  end if;
  if v_candidate.decision <> 'pending' then
    raise exception 'candidate already decided' using errcode = 'MR422';
  end if;

  if p_decision = 'rejected' then
    update public.match_candidates as m
       set decision = 'rejected', reviewer_id = v_actor, decided_at = now()
     where m.id = v_candidate.id;
    return query select v_candidate.id, 'rejected'::public.match_decision, v_candidate.candidate_case_id;
    return;
  end if;

  select mc.* into v_target from public.maintenance_cases as mc where mc.id = v_candidate.candidate_case_id for update;
  if v_target.status in ('closed', 'merged') then
    raise exception 'the candidate case is no longer open' using errcode = 'MR422';
  end if;
  if v_target.version is distinct from p_expected_case_version then
    raise exception 'the candidate case changed' using errcode = 'MR412';
  end if;

  select c.* into strict v_ticket from public.complaints as c where c.id = v_candidate.complaint_id for update;
  select mc.* into v_old
    from public.case_reports as cr
    join public.maintenance_cases as mc on mc.id = cr.case_id
   where cr.complaint_id = v_ticket.id
     for update of mc;
  if not found or v_old.id = v_target.id
     or (select count(*) from public.case_reports as cr where cr.case_id = v_old.id) > 1 then
    raise exception 'the report already shares a case' using errcode = 'MR422';
  end if;

  -- Move the report; its own case is kept, marked merged, so its history stays readable.
  update public.case_reports as cr
     set case_id = v_target.id, linked_by = v_actor, linked_at = now(), matching_decision_id = v_candidate.id
   where cr.complaint_id = v_ticket.id;
  update public.maintenance_cases as mc
     set status = 'merged', merged_into_case_id = v_target.id, closed_at = null, version = mc.version + 1
   where mc.id = v_old.id;
  insert into public.case_events (case_id, event_type, actor_id, actor_kind, previous_status, new_status, complaint_id, note)
  values (v_old.id, 'merged', v_actor, 'user', v_old.status, 'merged', v_ticket.id,
          format('Report MIR-%s linked into case MC-%s.', v_ticket.reference_no, v_target.reference_no));

  -- An unrouted case takes the routing the new report already has; otherwise the report
  -- follows the case.
  if v_target.assigned_department_id is null and v_ticket.assigned_department_id is not null then
    update public.maintenance_cases as mc
       set status = private.case_status_for_ticket(v_ticket.status),
           assigned_department_id = v_ticket.assigned_department_id,
           category = v_ticket.category,
           priority = v_ticket.priority,
           version = mc.version + 1
     where mc.id = v_target.id
    returning mc.* into v_target;
  else
    update public.maintenance_cases as mc set version = mc.version + 1 where mc.id = v_target.id
    returning mc.* into v_target;
  end if;
  insert into public.case_events (case_id, event_type, actor_id, actor_kind, previous_status, new_status, department_id, complaint_id, note)
  values (v_target.id, 'report_linked', v_actor, 'user', v_target.status, v_target.status,
          v_target.assigned_department_id, v_ticket.id,
          format('Report MIR-%s linked as the same problem.', v_ticket.reference_no));

  update public.match_candidates as m
     set decision = case when m.id = v_candidate.id then 'accepted' else 'superseded' end::public.match_decision,
         reviewer_id = v_actor, decided_at = now()
   where m.complaint_id = v_ticket.id and m.decision = 'pending';

  perform private.apply_case_to_ticket(
    v_target, v_ticket.id,
    -- The timeline already explains the link; the note only names the case.
    format('Shared case MC-%s.', v_target.reference_no),
    'case_linked');
  -- Earlier reports follow the case too (relevant when the case just took this report's routing).
  for v_sibling in
    select cr.complaint_id from public.case_reports as cr
     where cr.case_id = v_target.id and cr.complaint_id <> v_ticket.id
  loop
    perform private.apply_case_to_ticket(
      v_target, v_sibling, format('Updated with the shared case MC-%s.', v_target.reference_no));
  end loop;

  return query select v_candidate.id, 'accepted'::public.match_decision, v_target.id;
end;
$$;

-- "Keep as a separate case": rejects every pending candidate of a report at once.
create function public.dismiss_match_candidates(p_complaint_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'admins only' using errcode = 'MR403';
  end if;
  update public.match_candidates as m
     set decision = 'rejected', reviewer_id = (select auth.uid()), decided_at = now()
   where m.complaint_id = p_complaint_id and m.decision = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.request_duplicate_check(uuid) from public, anon, authenticated;
revoke all on function public.review_match_candidate(uuid, public.match_decision, integer) from public, anon, authenticated;
revoke all on function public.dismiss_match_candidates(uuid) from public, anon, authenticated;
grant execute on function public.request_duplicate_check(uuid) to authenticated;
grant execute on function public.review_match_candidate(uuid, public.match_decision, integer) to authenticated;
grant execute on function public.dismiss_match_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Worker functions (service role only)
-- ---------------------------------------------------------------------------------------------
-- The report text to embed, and the embedding it already has (to skip unchanged text).
create function public.worker_embedding_context(p_complaint_id uuid)
returns table (
  complaint_id uuid, title text, description text, category public.complaint_category,
  building text, room text, model text, text_hash text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.title, c.description, c.category, c.building, c.room, e.model, e.text_hash
    from public.complaints as c
    left join public.complaint_embeddings as e on e.complaint_id = c.id
   where c.id = p_complaint_id;
$$;

-- Stores a report's vector (or confirms the stored one is current when p_embedding is null) and
-- queues its duplicate match in the same transaction.
create function public.worker_save_embedding(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_model text,
  p_text_hash text,
  p_embedding real[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
begin
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);
  if v_job.job_type <> 'embedding' then
    raise exception 'not an embedding job' using errcode = '22023';
  end if;

  if p_embedding is null then
    if not exists (select 1 from public.complaint_embeddings as e
                    where e.complaint_id = v_job.target_id and e.model = p_model and e.text_hash = p_text_hash) then
      raise exception 'no current embedding to reuse' using errcode = '22023';
    end if;
  else
    if cardinality(p_embedding) <> 768 then
      raise exception 'an embedding has 768 dimensions' using errcode = '22023';
    end if;
    insert into public.complaint_embeddings (complaint_id, model, embedding, text_hash)
    values (v_job.target_id, p_model, p_embedding::extensions.vector(768), p_text_hash)
    on conflict (complaint_id) do update
       set model = excluded.model, embedding = excluded.embedding,
           text_hash = excluded.text_hash, updated_at = now();
  end if;

  return private.enqueue_ai_job(
    'duplicate_match', v_job.target_id,
    'duplicate_match:' || v_job.target_id::text || ':' || p_model || ':' || p_text_hash);
end;
$$;

-- Candidate cases for a report, with the features the ranker needs (F2.03). Scope: open,
-- unmerged cases opened in the last 30 days, in the same building (by location or by the
-- reports' building text), with at least one report embedded by the same model.
create function public.worker_duplicate_features(p_complaint_id uuid, p_model text, p_limit integer default 10)
returns table (
  case_id uuid,
  case_reference integer,
  similarity real,
  same_building boolean,
  same_room boolean,
  category_match boolean,
  same_asset boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select c.id, c.category, lower(btrim(c.building)) as building, lower(btrim(coalesce(c.room, ''))) as room,
           e.embedding, cr.case_id as own_case, mc.location_id, mc.asset_id, l.building_code
      from public.complaints as c
      join public.complaint_embeddings as e on e.complaint_id = c.id and e.model = p_model
      join public.case_reports as cr on cr.complaint_id = c.id
      join public.maintenance_cases as mc on mc.id = cr.case_id
      left join public.maintenance_locations as l on l.id = mc.location_id
     where c.id = p_complaint_id
  ),
  scored as (
    select mc.id as case_id,
           mc.reference_no,
           max(1 - (e.embedding operator(extensions.<=>) me.embedding))::real as similarity,
           bool_or(lower(btrim(c.building)) = me.building)
             or (me.building_code is not null and max(l.building_code) = me.building_code) as same_building,
           (me.location_id is not null and mc.location_id = me.location_id)
             or bool_or(me.room <> '' and lower(btrim(c.building)) = me.building
                        and lower(btrim(coalesce(c.room, ''))) = me.room) as same_room,
           -- Compatible: the same category, or one not classified yet (routing off or pending).
           -- An unknown category is no evidence of a different problem.
           (me.category = 'unclassified' or mc.category = 'unclassified' or mc.category = me.category) as category_match,
           (me.asset_id is not null and mc.asset_id = me.asset_id) as same_asset
      from me
      join public.maintenance_cases as mc
        on mc.id <> me.own_case
       and mc.status not in ('closed', 'merged')
       and mc.opened_at > now() - interval '30 days'
      join public.case_reports as cr on cr.case_id = mc.id
      join public.complaints as c on c.id = cr.complaint_id
      join public.complaint_embeddings as e on e.complaint_id = c.id and e.model = p_model
      left join public.maintenance_locations as l on l.id = mc.location_id
     group by mc.id, mc.reference_no, mc.location_id, mc.category, mc.asset_id,
              me.building, me.building_code, me.location_id, me.room, me.category, me.asset_id
  )
  select s.case_id, s.reference_no, s.similarity, s.same_building, s.same_room, s.category_match, s.same_asset
    from scored as s
   where s.same_building
   order by s.similarity desc
   limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

-- Stores the ranked candidates the worker chose. A pair already decided (or already proposed)
-- is left as it is: a rejected match stays rejected.
create function public.worker_save_match_candidates(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_model text,
  p_candidates jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
  v_count integer;
begin
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);
  if v_job.job_type <> 'duplicate_match' then
    raise exception 'not a duplicate match job' using errcode = '22023';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 5 then
    raise exception 'at most five candidates' using errcode = '22023';
  end if;

  insert into public.match_candidates
    (complaint_id, candidate_case_id, model, similarity, score, same_building, same_room, category_match, same_asset)
  select v_job.target_id, x.case_id, p_model, x.similarity, x.score, x.same_building, x.same_room, x.category_match, x.same_asset
    from jsonb_to_recordset(p_candidates) as x (
      case_id uuid, similarity real, score real, same_building boolean, same_room boolean,
      category_match boolean, same_asset boolean)
   where x.case_id <> (select cr.case_id from public.case_reports as cr where cr.complaint_id = v_job.target_id)
  on conflict (complaint_id, candidate_case_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.worker_embedding_context(uuid) from public, anon, authenticated;
revoke all on function public.worker_save_embedding(uuid, bigint, smallint, text, text, real[]) from public, anon, authenticated;
revoke all on function public.worker_duplicate_features(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.worker_save_match_candidates(uuid, bigint, smallint, text, jsonb) from public, anon, authenticated;
grant execute on function public.worker_embedding_context(uuid) to service_role;
grant execute on function public.worker_save_embedding(uuid, bigint, smallint, text, text, real[]) to service_role;
grant execute on function public.worker_duplicate_features(uuid, text, integer) to service_role;
grant execute on function public.worker_save_match_candidates(uuid, bigint, smallint, text, jsonb) to service_role;
