-- Before/after repair verification (Advanced Features plan v2 §09, F4.01-F4.05; ADR 0013).
--
--   * Staff of the department holding a case, and administrators, add BEFORE and AFTER repair
--     photos to the case's private evidence. Photos are never replaced: a row per photo, and the
--     A1 Storage policies allow no updates.
--   * Finalising an AFTER photo opens one verification review and queues a paired-photo
--     comparison (repair_verify). The AI result is a suggestion stored on the review; nothing in
--     the AI path can change a case's status.
--   * Closing or reworking stays a person's decision through the audited ticket transitions
--     (reporter for their own report, an administrator for the whole case). A trigger records
--     that decision on the open review and in the case's event log.
--
-- Error codes as elsewhere: MR403 role, MR404 not visible, MR412 stale version, MR413 too large,
-- MR422 not allowed now, MR429 limit, MR400 object mismatch, 22023 invalid input.

-- ---------------------------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------------------------
create type public.repair_evidence_kind as enum ('before', 'after');
create type public.verification_ai_status as enum (
  'visually_improved', 'possibly_unresolved', 'inconclusive', 'not_comparable'
);
create type public.verification_state as enum ('pending', 'awaiting_decision', 'confirmed', 'rework', 'superseded');

create table public.repair_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  -- Created with the upload reservation; a photo counts once its attachment is finalised.
  attachment_id uuid not null unique references public.evidence_attachments (id) on delete cascade,
  evidence_kind public.repair_evidence_kind not null,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.repair_evidence is
  'Before/after repair photos of a case (plan v2 F4.01). Append-only; bytes are in private Storage.';

create index repair_evidence_case_idx on public.repair_evidence (case_id, evidence_kind, created_at desc);

create trigger repair_evidence_immutable
  before update on public.repair_evidence
  for each row execute function private.reject_history_update();

create table public.verification_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.maintenance_cases (id) on delete cascade,
  after_attachment_id uuid not null unique references public.evidence_attachments (id) on delete cascade,
  -- Null when the case has no before photo: the comparison is then NOT_COMPARABLE.
  before_attachment_id uuid references public.evidence_attachments (id) on delete set null,
  job_id uuid references public.ai_jobs (id) on delete set null,
  state public.verification_state not null default 'pending',
  ai_status public.verification_ai_status,
  model text constraint verification_reviews_model_format check (model is null or model ~ '^[a-z0-9][a-z0-9.-]{1,63}$'),
  prompt_version text constraint verification_reviews_prompt_format
    check (prompt_version is null or prompt_version ~ '^verify-v[0-9]+$'),
  -- Observations before and after, the visible changes and what could not be seen (F4.02).
  ai_result jsonb constraint verification_reviews_result_object check (ai_result is null or jsonb_typeof(ai_result) = 'object'),
  uncertainty_flags text[] not null default '{}'
    constraint verification_reviews_flags_format check (array_to_string(uncertainty_flags, ',') ~ '^([A-Z_]{3,40}(,[A-Z_]{3,40})*)?$'),
  explanation text constraint verification_reviews_explanation_length
    check (explanation is null or char_length(explanation) between 1 and 400),
  analysed_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text constraint verification_reviews_note_length
    check (decision_note is null or char_length(decision_note) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint verification_reviews_ai_fields_together check (
    (ai_status is null) = (analysed_at is null)
    and (ai_status is null) = (model is null)
    and (ai_status is null) = (prompt_version is null)
    and (ai_status is null) = (explanation is null)
  ),
  constraint verification_reviews_decided check ((state in ('pending', 'awaiting_decision')) = (decided_at is null))
);

comment on table public.verification_reviews is
  'One AI-assisted before/after comparison per after photo (plan v2 F4). Suggestions only: a person decides.';

create unique index verification_reviews_one_open on public.verification_reviews (case_id)
  where state in ('pending', 'awaiting_decision');
create index verification_reviews_case_idx on public.verification_reviews (case_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Visibility: staff with the case, and the reporters of the case's own reports (F4.04)
-- ---------------------------------------------------------------------------------------------
create function private.is_case_reporter(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.case_reports as cr
      join public.complaints as c on c.id = cr.complaint_id
     where cr.case_id = p_case_id and c.created_by = (select auth.uid())
  );
$$;

revoke all on function private.is_case_reporter(uuid) from public, anon, authenticated;
grant execute on function private.is_case_reporter(uuid) to authenticated;

alter table public.repair_evidence enable row level security;
alter table public.verification_reviews enable row level security;
revoke all on table public.repair_evidence, public.verification_reviews from anon, authenticated;
grant select on table public.repair_evidence, public.verification_reviews to authenticated;

create policy repair_evidence_select_with_case
  on public.repair_evidence for select
  to authenticated
  using (
    exists (select 1 from public.maintenance_cases as mc where mc.id = case_id)
    or (select private.is_case_reporter(case_id))
  );

create policy verification_reviews_select_with_case
  on public.verification_reviews for select
  to authenticated
  using (
    exists (select 1 from public.maintenance_cases as mc where mc.id = case_id)
    or (select private.is_case_reporter(case_id))
  );

-- Repair photos are part of the case: its reporters see them too (reporter photos stay private
-- to their own report, as before).
drop policy evidence_attachments_select_with_parent on public.evidence_attachments;
create policy evidence_attachments_select_with_parent
  on public.evidence_attachments for select
  to authenticated
  using (
    exists (select 1 from public.complaints as c where c.id = complaint_id)
    or exists (select 1 from public.maintenance_cases as mc where mc.id = case_id)
    or (case_id is not null and (select private.is_case_reporter(case_id)))
  );

-- The verification view of one report (F4.04), for anyone who can see the report: its case's
-- repair photos and latest reviews. Reporters cannot list case links (A0 guarantee), so this
-- function resolves the report's case for them and returns nothing about other reports.
create function public.repair_verification_view(p_complaint_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select private.current_app_role());
  v_case public.maintenance_cases;
begin
  -- The same visibility as complaints_select_scoped: own report, the assigned department, admins.
  if not exists (
    select 1 from public.complaints as c
     where c.id = p_complaint_id
       and (c.created_by = v_actor
            or v_role = 'admin'
            or (v_role = 'department' and c.assigned_department_id = (select private.current_department_id())))
  ) then
    return null;
  end if;
  select mc.* into v_case
    from public.case_reports as cr join public.maintenance_cases as mc on mc.id = cr.case_id
   where cr.complaint_id = p_complaint_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'case_id', v_case.id,
    'reference', 'MC-' || v_case.reference_no,
    'case_status', v_case.status,
    'can_upload', v_case.status in ('assigned', 'in_progress', 'reopened', 'resolved')
                  and (v_role = 'admin'
                       or (v_role = 'department' and v_case.assigned_department_id = (select private.current_department_id()))),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('attachment_id', a.id, 'kind', e.evidence_kind, 'object_path', a.object_path,
                                          'added_at', a.finalized_at) order by a.finalized_at)
        from public.repair_evidence as e join public.evidence_attachments as a on a.id = e.attachment_id
       where e.case_id = v_case.id and a.state = 'finalized'), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (
          select v.id, v.state, v.ai_status, v.model, v.prompt_version, v.ai_result, v.uncertainty_flags,
                 v.explanation, v.analysed_at, v.decided_at, v.decision_note, v.created_at,
                 v.after_attachment_id,
                 v.before_attachment_id,
                 (select case when b.case_id is null then 'report' else 'repair' end
                    from public.evidence_attachments as b where b.id = v.before_attachment_id) as before_source,
                 (select b.object_path from public.evidence_attachments as b where b.id = v.before_attachment_id) as before_path,
                 (select a.object_path from public.evidence_attachments as a where a.id = v.after_attachment_id) as after_path
            from public.verification_reviews as v
           where v.case_id = v_case.id
           order by v.created_at desc
           limit 3
        ) as r), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.repair_verification_view(uuid) from public, anon, authenticated;
grant execute on function public.repair_verification_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Uploading repair photos (F4.01): staff of the case or an administrator only
-- ---------------------------------------------------------------------------------------------
create function public.request_repair_evidence_upload(
  p_case_id uuid,
  p_kind public.repair_evidence_kind,
  p_mime_type text,
  p_byte_size integer
)
returns table (attachment_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select private.current_app_role());
  v_case public.maintenance_cases;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_actor is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if v_role is distinct from 'admin' and v_role is distinct from 'department' then
    -- A reporter can never add repair evidence (F4.01: no impersonating a technician).
    raise exception 'staff only' using errcode = 'MR403';
  end if;
  if p_kind is null then
    raise exception 'evidence kind is required' using errcode = '22023';
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'unsupported image type' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 then
    raise exception 'invalid size' using errcode = '22023';
  end if;
  if p_byte_size > 2097152 then
    raise exception 'image too large' using errcode = 'MR413';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('evidence:' || v_actor::text, 0));

  select mc.* into v_case from public.maintenance_cases as mc where mc.id = p_case_id;
  if not found or v_case.is_synthetic
     or (v_role = 'department' and v_case.assigned_department_id is distinct from (select private.current_department_id())) then
    raise exception 'case not found' using errcode = 'MR404';
  end if;
  if v_case.status not in ('assigned', 'in_progress', 'reopened', 'resolved') then
    raise exception 'repair photos are for cases being worked on' using errcode = 'MR422';
  end if;
  if p_kind = 'after' and exists (
    select 1 from public.verification_reviews as v
     where v.case_id = p_case_id and v.state in ('pending', 'awaiting_decision')
  ) then
    raise exception 'an after photo is already awaiting a decision' using errcode = 'MR422';
  end if;

  if (select count(*) from public.evidence_attachments as a
       where a.case_id = p_case_id and a.state <> 'rejected') >= 12 then
    raise exception 'photo limit reached for this case' using errcode = 'MR429';
  end if;
  if (select count(*) from public.evidence_attachments as a
       where a.uploaded_by = v_actor and a.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'upload rate limit' using errcode = 'MR429';
  end if;

  v_path := v_actor::text || '/' || v_id::text || '.' || case p_mime_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;

  insert into public.evidence_attachments (id, case_id, uploaded_by, object_path, mime_type, byte_size)
  values (v_id, p_case_id, v_actor, v_path, p_mime_type, p_byte_size);
  insert into public.repair_evidence (case_id, attachment_id, evidence_kind, uploaded_by)
  values (p_case_id, v_id, p_kind, v_actor);

  return query select v_id, v_path;
end;
$$;

-- Completes a repair photo once the server has checked its bytes. An AFTER photo opens the
-- case's verification review and queues the comparison, in the same transaction. Repeating the
-- call returns the same review and job.
create function public.finalize_repair_evidence_upload(
  p_attachment_id uuid,
  p_sha256 text,
  p_byte_size integer,
  p_mime_type text
)
returns table (attachment_id uuid, review_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_attachment public.evidence_attachments;
  v_evidence public.repair_evidence;
  v_case public.maintenance_cases;
  v_object storage.objects;
  v_before uuid;
  v_review uuid;
  v_job uuid;
begin
  if v_actor is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select a.* into v_attachment from public.evidence_attachments as a where a.id = p_attachment_id for update;
  if not found or v_attachment.uploaded_by <> v_actor or v_attachment.case_id is null then
    raise exception 'upload not found' using errcode = 'MR404';
  end if;
  select e.* into strict v_evidence from public.repair_evidence as e where e.attachment_id = v_attachment.id;

  if v_attachment.state = 'finalized' then
    select v.id, v.job_id into v_review, v_job from public.verification_reviews as v
     where v.after_attachment_id = v_attachment.id;
    return query select v_attachment.id, v_review, v_job;
    return;
  end if;
  if v_attachment.state = 'rejected' then
    raise exception 'upload was rejected' using errcode = 'MR422';
  end if;
  if v_attachment.created_at <= now() - private.evidence_upload_window() then
    raise exception 'upload window expired' using errcode = 'MR422';
  end if;

  select o.* into v_object from storage.objects as o
   where o.bucket_id = v_attachment.bucket and o.name = v_attachment.object_path;
  if not found then
    raise exception 'uploaded object not found' using errcode = 'MR404';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_byte_size is distinct from v_attachment.byte_size
     or p_mime_type is distinct from v_attachment.mime_type
     or (v_object.metadata ->> 'size')::bigint is distinct from v_attachment.byte_size::bigint
     or (v_object.metadata ->> 'mimetype') is distinct from v_attachment.mime_type then
    raise exception 'uploaded object does not match the request' using errcode = 'MR400';
  end if;

  select mc.* into strict v_case from public.maintenance_cases as mc where mc.id = v_attachment.case_id for update;
  if v_case.status not in ('assigned', 'in_progress', 'reopened', 'resolved') then
    raise exception 'repair photos are for cases being worked on' using errcode = 'MR422';
  end if;

  update public.evidence_attachments as a
     set state = 'finalized', finalized_at = now(), sha256 = p_sha256
   where a.id = v_attachment.id;
  insert into public.case_events (case_id, event_type, actor_id, actor_kind, note)
  values (v_case.id, 'repair_evidence_added', v_actor, 'user',
          case v_evidence.evidence_kind when 'before' then 'Before-repair photo added.' else 'After-repair photo added.' end);

  if v_evidence.evidence_kind = 'after' then
    if exists (
      select 1 from public.verification_reviews as v
       where v.case_id = v_case.id and v.state in ('pending', 'awaiting_decision')
    ) then
      raise exception 'an after photo is already awaiting a decision' using errcode = 'MR422';
    end if;
    -- The comparison's before photo: the latest staff BEFORE photo, else the first photo a
    -- reporter attached to one of the case's reports.
    select e.attachment_id into v_before
      from public.repair_evidence as e
      join public.evidence_attachments as a on a.id = e.attachment_id
     where e.case_id = v_case.id and e.evidence_kind = 'before' and a.state = 'finalized'
     order by a.finalized_at desc
     limit 1;
    if v_before is null then
      select a.id into v_before
        from public.case_reports as cr
        join public.evidence_attachments as a on a.complaint_id = cr.complaint_id
       where cr.case_id = v_case.id and a.state = 'finalized'
       order by a.finalized_at
       limit 1;
    end if;

    insert into public.verification_reviews (case_id, after_attachment_id, before_attachment_id)
    values (v_case.id, v_attachment.id, v_before)
    returning id into v_review;
    v_job := private.enqueue_ai_job('repair_verify', v_review, 'repair_verify:' || v_review::text);
    update public.verification_reviews as v set job_id = v_job where v.id = v_review;
  end if;

  return query select v_attachment.id, v_review, v_job;
end;
$$;

revoke all on function public.request_repair_evidence_upload(uuid, public.repair_evidence_kind, text, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_repair_evidence_upload(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.request_repair_evidence_upload(uuid, public.repair_evidence_kind, text, integer)
  to authenticated;
grant execute on function public.finalize_repair_evidence_upload(uuid, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Human decisions (F4.04-F4.05)
-- ---------------------------------------------------------------------------------------------
-- A person's close or rework of the case settles its open review, whichever path they used (the
-- verification endpoint or the usual ticket controls). The AI path never changes case status.
create function private.settle_verification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.verification_state;
  v_review uuid;
begin
  v_state := case new.status
    when 'closed' then 'confirmed'
    when 'reopened' then 'rework'
    when 'merged' then 'superseded'
  end::public.verification_state;
  if v_state is null then
    return null;
  end if;

  update public.verification_reviews as v
     set state = v_state, decided_by = (select auth.uid()), decided_at = now()
   where v.case_id = new.id and v.state in ('pending', 'awaiting_decision')
  returning v.id into v_review;
  if v_review is not null then
    insert into public.case_events (case_id, event_type, actor_id, actor_kind, previous_status, new_status, note)
    values (new.id, 'verification_decided', (select auth.uid()),
            case when (select auth.uid()) is null then 'system' else 'user' end::public.ticket_actor_kind,
            old.status, new.status,
            case v_state
              when 'confirmed' then 'Repair confirmed by a person; the case is closed.'
              when 'rework' then 'Repair disputed; the work order is open again with its photos kept.'
              else 'The case was merged; its verification is no longer needed.'
            end);
  end if;
  return null;
end;
$$;

revoke all on function private.settle_verification_review() from public, anon, authenticated;

create trigger maintenance_cases_settle_verification
  after update of status on public.maintenance_cases
  for each row
  when (old.status is distinct from new.status and new.status in ('closed', 'reopened', 'merged'))
  execute function private.settle_verification_review();

-- POST /api/cases/[id]/verification-decision (plan §12): a reporter confirms or disputes their own
-- report; an administrator closes or reopens the whole case. The decision names the open review
-- the person looked at: one already settled is stale (MR412). Both go through transition_ticket,
-- so the usual rules, notes and events apply; departments cannot judge their own repair.
create function public.decide_repair_verification(
  p_review_id uuid,
  p_confirm boolean,
  p_note text default null
)
returns public.maintenance_case_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select private.current_app_role());
  v_review public.verification_reviews;
  v_case public.maintenance_cases;
  v_ticket public.complaints;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_confirm is null then
    raise exception 'a decision is required' using errcode = '22023';
  end if;
  if v_role = 'department' then
    raise exception 'the department cannot confirm its own repair' using errcode = 'MR403';
  end if;

  select v.* into v_review from public.verification_reviews as v where v.id = p_review_id;
  if not found or (v_role = 'student' and not private.is_case_reporter(v_review.case_id)) then
    raise exception 'verification not found' using errcode = 'MR404';
  end if;
  select mc.* into strict v_case from public.maintenance_cases as mc where mc.id = v_review.case_id for update;
  -- Re-read under the case lock: someone may have decided meanwhile.
  select v.* into strict v_review from public.verification_reviews as v where v.id = p_review_id;
  if v_review.state not in ('pending', 'awaiting_decision') then
    raise exception 'this verification was already settled' using errcode = 'MR412';
  end if;

  if v_role = 'student' then
    select c.* into v_ticket
      from public.case_reports as cr join public.complaints as c on c.id = cr.complaint_id
     where cr.case_id = v_case.id and c.created_by = v_actor and c.status = 'resolved'
     order by cr.linked_at
     limit 1;
  else
    if v_case.status <> 'resolved' then
      raise exception 'only a resolved case can be confirmed or reworked' using errcode = 'MR422';
    end if;
    -- An administrator's change on any linked report leads the shared case (ADR 0011).
    select c.* into v_ticket
      from public.case_reports as cr join public.complaints as c on c.id = cr.complaint_id
     where cr.case_id = v_case.id and c.status = 'resolved'
     order by cr.linked_at
     limit 1;
  end if;
  if v_ticket.id is null then
    raise exception 'nothing is waiting for confirmation' using errcode = 'MR422';
  end if;

  perform public.transition_ticket(
    v_ticket.id, case when p_confirm then 'closed' else 'reopened' end::public.ticket_state,
    v_ticket.version, v_note);

  update public.verification_reviews as v set decision_note = left(v_note, 1000)
   where v.id = v_review.id and v.decided_at is not null and v_note is not null;

  return (select mc.status from public.maintenance_cases as mc where mc.id = v_case.id);
end;
$$;

revoke all on function public.decide_repair_verification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_repair_verification(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Worker functions (F4.03): service role only
-- ---------------------------------------------------------------------------------------------
-- The comparison's inputs: both photos (paths, sizes, checksums) and the case's report text.
create function public.worker_verification_context(p_review_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'review_id', v.id,
    'case_id', mc.id,
    'reference', 'MC-' || mc.reference_no,
    'category', mc.category,
    'after', (select jsonb_build_object('attachment_id', a.id, 'object_path', a.object_path, 'mime_type', a.mime_type,
                                        'byte_size', a.byte_size, 'sha256', a.sha256)
                from public.evidence_attachments as a where a.id = v.after_attachment_id and a.state = 'finalized'),
    'before', (select jsonb_build_object('attachment_id', a.id, 'object_path', a.object_path, 'mime_type', a.mime_type,
                                         'byte_size', a.byte_size, 'sha256', a.sha256,
                                         'source', case when a.case_id is null then 'report' else 'repair' end)
                 from public.evidence_attachments as a where a.id = v.before_attachment_id and a.state = 'finalized'),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('title', c.title, 'description', c.description) order by cr.linked_at)
        from public.case_reports as cr join public.complaints as c on c.id = cr.complaint_id
       where cr.case_id = mc.id), '[]'::jsonb)
  )
    from public.verification_reviews as v
    join public.maintenance_cases as mc on mc.id = v.case_id
   where v.id = p_review_id;
$$;

-- Stores the validated comparison on its review. Idempotent per job (a retry returns the first
-- result) and never touches the case's status: only a person closes or reopens a case.
create function public.worker_save_verification(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_prompt_version text,
  p_model text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
  v_review public.verification_reviews;
  v_status public.verification_ai_status;
  v_flags text[];
begin
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);
  if v_job.job_type <> 'repair_verify' then
    raise exception 'not a verification job' using errcode = '22023';
  end if;
  select v.* into v_review from public.verification_reviews as v where v.id = v_job.target_id for update;
  if not found then
    raise exception 'review not found' using errcode = 'MR404';
  end if;
  if v_review.ai_status is not null then
    return jsonb_build_object('review_id', v_review.id, 'ai_status', v_review.ai_status);
  end if;

  v_status := (p_result ->> 'ai_status')::public.verification_ai_status;
  v_flags := array(select jsonb_array_elements_text(coalesce(p_result -> 'uncertainty_flags', '[]'::jsonb)));
  update public.verification_reviews as v
     set ai_status = v_status,
         model = p_model,
         prompt_version = p_prompt_version,
         ai_result = jsonb_build_object(
           'before_observations', coalesce(p_result -> 'before_observations', '[]'::jsonb),
           'after_observations', coalesce(p_result -> 'after_observations', '[]'::jsonb),
           'visible_changes', coalesce(p_result -> 'visible_changes', '[]'::jsonb),
           'not_visible_or_uncertain', coalesce(p_result -> 'not_visible_or_uncertain', '[]'::jsonb),
           'functional_test_not_performed', true),
         uncertainty_flags = v_flags,
         explanation = p_result ->> 'explanation',
         analysed_at = now(),
         state = case when v.state = 'pending' then 'awaiting_decision' else v.state end
   where v.id = v_review.id;

  insert into public.case_events (case_id, event_type, actor_kind, note)
  values (v_review.case_id, 'verification_result', 'agent',
          format('AI photo comparison (a suggestion, not a decision): %s.', replace(v_status::text, '_', ' ')));
  return jsonb_build_object('review_id', v_review.id, 'ai_status', v_status);
end;
$$;

revoke all on function public.worker_verification_context(uuid) from public, anon, authenticated;
revoke all on function public.worker_save_verification(uuid, bigint, smallint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.worker_verification_context(uuid) to service_role;
grant execute on function public.worker_save_verification(uuid, bigint, smallint, text, text, jsonb) to service_role;
