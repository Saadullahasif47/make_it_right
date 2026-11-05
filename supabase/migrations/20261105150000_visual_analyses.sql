-- MakeItRight add-on A2: AI visual inspection results (Advanced Features plan v2 §06, F1.03-F1.05,
-- A2.01-A2.02).
--
--   * visual_analyses holds what the model said about one photo, validated by the worker and
--     checked again here. It is the model's audit record: nobody can edit or delete it, not even
--     an admin. One row per (photo, prompt version), so a retried job never stores twice.
--   * People respond in visual_analysis_reviews, an append-only log: the reporter can confirm or
--     dispute what the AI saw, an admin can also record a corrected category. A review never
--     changes the analysis, the ticket's category or its routing.
--   * The worker reads a photo's context and saves its result through two service-role
--     functions. Reporters, staff and admins read analyses exactly when they can read the ticket.

create type public.image_quality as enum ('usable', 'blurry', 'dark', 'unrelated');
create type public.text_image_consistency as enum ('consistent', 'inconsistent', 'unclear');
create type public.visual_review_decision as enum ('confirmed', 'disputed', 'corrected');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.visual_analyses (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  attachment_id uuid not null references public.evidence_attachments (id) on delete cascade,
  job_id uuid references public.ai_jobs (id) on delete set null,
  prompt_version text not null constraint visual_analyses_prompt_version_format
    check (prompt_version ~ '^visual-v[0-9]+$'),
  model text not null constraint visual_analyses_model_format check (model ~ '^[a-z0-9][a-z0-9.-]{1,63}$'),
  visible_observations text[] not null constraint visual_analyses_observations_bounds
    check (cardinality(visible_observations) between 1 and 6),
  possible_issue text not null constraint visual_analyses_possible_issue_length
    check (char_length(possible_issue) between 1 and 120),
  -- Null when the model could not tell (it answered "unclear").
  suggested_category public.complaint_category
    constraint visual_analyses_category_classified check (suggested_category is distinct from 'unclassified'),
  severity_hint public.ticket_priority not null
    constraint visual_analyses_severity_assessed check (severity_hint <> 'unassessed'),
  not_visible_or_uncertain text[] not null default '{}'
    constraint visual_analyses_uncertain_bounds check (cardinality(not_visible_or_uncertain) <= 6),
  image_quality public.image_quality not null,
  text_consistency public.text_image_consistency not null,
  needs_human_review boolean not null,
  -- Derived by the worker's policy from the fields above (IMAGE_BLURRY, TEXT_IMAGE_MISMATCH, ...).
  uncertainty_flags text[] not null default '{}'
    constraint visual_analyses_flags_format check (array_to_string(uncertainty_flags, ',') ~ '^([A-Z_]{3,40}(,[A-Z_]{3,40})*)?$'),
  explanation text not null constraint visual_analyses_explanation_length
    check (char_length(explanation) between 1 and 400),
  created_at timestamptz not null default now(),
  constraint visual_analyses_one_per_prompt unique (attachment_id, prompt_version),
  -- Anything the model was unsure of must go to a person.
  constraint visual_analyses_review_when_unsure check (
    needs_human_review
    or (image_quality = 'usable' and text_consistency <> 'inconsistent' and suggested_category is not null)
  )
);

comment on table public.visual_analyses is
  'AI observations about one photo (plan v2 F1). Immutable audit record; suggestions only.';

create index visual_analyses_complaint_idx on public.visual_analyses (complaint_id, created_at);

create table public.visual_analysis_reviews (
  id bigint generated always as identity primary key,
  analysis_id uuid not null references public.visual_analyses (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewer_role public.app_role not null,
  decision public.visual_review_decision not null,
  corrected_category public.complaint_category
    constraint visual_analysis_reviews_category_classified check (corrected_category is distinct from 'unclassified'),
  note text constraint visual_analysis_reviews_note_length check (note is null or char_length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint visual_analysis_reviews_correction_has_category
    check ((decision = 'corrected') = (corrected_category is not null))
);

comment on table public.visual_analysis_reviews is
  'Append-only human responses to a visual analysis. They never change the analysis itself.';

create index visual_analysis_reviews_analysis_idx on public.visual_analysis_reviews (analysis_id, created_at, id);

create trigger visual_analyses_immutable
  before update on public.visual_analyses
  for each row execute function private.reject_history_update();

create trigger visual_analysis_reviews_append_only
  before update on public.visual_analysis_reviews
  for each row execute function private.reject_history_update();

-- ---------------------------------------------------------------------------------------------
-- Row-level security: read with the ticket, write only through functions
-- ---------------------------------------------------------------------------------------------
alter table public.visual_analyses enable row level security;
alter table public.visual_analysis_reviews enable row level security;
revoke all on table public.visual_analyses, public.visual_analysis_reviews from anon, authenticated;
grant select on table public.visual_analyses, public.visual_analysis_reviews to authenticated;

create policy visual_analyses_select_with_complaint
  on public.visual_analyses for select
  to authenticated
  using (exists (select 1 from public.complaints as c where c.id = complaint_id));

create policy visual_analysis_reviews_select_with_analysis
  on public.visual_analysis_reviews for select
  to authenticated
  using (exists (select 1 from public.visual_analyses as v where v.id = analysis_id));

-- ---------------------------------------------------------------------------------------------
-- Worker functions (service role only)
-- ---------------------------------------------------------------------------------------------
-- What the vision handler needs about one finalised photo: where it is and the report it
-- belongs to. Only text the reporter wrote; no names or accounts.
create function public.worker_visual_context(p_attachment_id uuid)
returns table (
  attachment_id uuid,
  complaint_id uuid,
  object_path text,
  mime_type text,
  byte_size integer,
  sha256 text,
  title text,
  description text,
  building text,
  room text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, c.id, a.object_path, a.mime_type, a.byte_size, a.sha256,
         c.title, c.description, c.building, c.room
    from public.evidence_attachments as a
    join public.complaints as c on c.id = a.complaint_id
   where a.id = p_attachment_id and a.state = 'finalized';
$$;

-- Stores one validated analysis for the job's photo. The job must be held by this attempt
-- (MR412 otherwise). If an earlier attempt already stored a result for the same prompt version,
-- that result stands and is returned: a retry never stores twice.
create function public.worker_save_visual_analysis(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_prompt_version text,
  p_model text,
  p_result jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
  v_attachment public.evidence_attachments;
  v_id uuid;
begin
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);
  if v_job.job_type <> 'visual_analysis' then
    raise exception 'not a visual analysis job' using errcode = '22023';
  end if;

  select a.* into v_attachment from public.evidence_attachments as a
   where a.id = v_job.target_id and a.state = 'finalized';
  if not found then
    raise exception 'photo not found' using errcode = 'MR404';
  end if;

  insert into public.visual_analyses (
    complaint_id, attachment_id, job_id, prompt_version, model,
    visible_observations, possible_issue, suggested_category, severity_hint,
    not_visible_or_uncertain, image_quality, text_consistency, needs_human_review,
    uncertainty_flags, explanation
  )
  values (
    v_attachment.complaint_id, v_attachment.id, v_job.id, p_prompt_version, p_model,
    array(select jsonb_array_elements_text(p_result -> 'visible_observations')),
    p_result ->> 'possible_issue',
    nullif(p_result ->> 'suggested_category', 'unclear')::public.complaint_category,
    (p_result ->> 'severity_hint')::public.ticket_priority,
    array(select jsonb_array_elements_text(coalesce(p_result -> 'not_visible_or_uncertain', '[]'::jsonb))),
    (p_result ->> 'image_quality')::public.image_quality,
    (p_result ->> 'text_consistency')::public.text_image_consistency,
    (p_result ->> 'needs_human_review')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_result -> 'uncertainty_flags', '[]'::jsonb))),
    p_result ->> 'explanation'
  )
  on conflict (attachment_id, prompt_version) do nothing
  returning id into v_id;

  if v_id is null then
    select v.id into strict v_id from public.visual_analyses as v
     where v.attachment_id = v_attachment.id and v.prompt_version = p_prompt_version;
  end if;
  return v_id;
end;
$$;

revoke all on function public.worker_visual_context(uuid) from public, anon, authenticated;
revoke all on function public.worker_save_visual_analysis(uuid, bigint, smallint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.worker_visual_context(uuid) to service_role;
grant execute on function public.worker_save_visual_analysis(uuid, bigint, smallint, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Functions for signed-in users
-- ---------------------------------------------------------------------------------------------
-- The analysis state of each finalised photo on a ticket the caller can see. Job records stay
-- admin-only; this exposes only the state a reporter needs ("analysing", "done", "with staff").
create function public.photo_analysis_states(p_complaint_id uuid)
returns table (attachment_id uuid, job_status public.ai_job_status)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := (select private.current_app_role());
begin
  if not exists (
    select 1 from public.complaints as c
     where c.id = p_complaint_id
       and (c.created_by = (select auth.uid())
            or v_role = 'admin'
            or (v_role = 'department' and c.assigned_department_id = (select private.current_department_id())))
  ) then
    raise exception 'complaint not found' using errcode = 'MR404';
  end if;

  return query
    select a.id, j.status
      from public.evidence_attachments as a
      left join public.ai_jobs as j on j.dedupe_key = 'visual_analysis:' || a.id::text
     where a.complaint_id = p_complaint_id and a.state = 'finalized'
     order by a.finalized_at;
end;
$$;

-- A person's response to an analysis. The reporter may confirm or dispute what the AI saw on
-- their own ticket; an admin may also record a corrected category. Other roles, and other
-- students, cannot respond. At most ten responses per person per analysis.
create function public.review_visual_analysis(
  p_analysis_id uuid,
  p_decision public.visual_review_decision,
  p_corrected_category public.complaint_category default null,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select private.current_app_role());
  v_reporter uuid;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_id bigint;
begin
  if v_actor is null or v_role is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select c.created_by into v_reporter
    from public.visual_analyses as v
    join public.complaints as c on c.id = v.complaint_id
   where v.id = p_analysis_id
     for share of v;
  if not found or (v_role <> 'admin' and v_reporter <> v_actor) then
    raise exception 'analysis not found' using errcode = 'MR404';
  end if;
  if p_decision = 'corrected' and v_role <> 'admin' then
    raise exception 'only an admin records a corrected category' using errcode = 'MR403';
  end if;
  if p_decision = 'disputed' and v_note is null then
    raise exception 'say what is wrong' using errcode = '22023';
  end if;
  if (select count(*) from public.visual_analysis_reviews as r
       where r.analysis_id = p_analysis_id and r.reviewer_id = v_actor) >= 10 then
    raise exception 'review limit reached' using errcode = 'MR429';
  end if;

  insert into public.visual_analysis_reviews (analysis_id, reviewer_id, reviewer_role, decision, corrected_category, note)
  values (p_analysis_id, v_actor, v_role, p_decision,
          case when p_decision = 'corrected' then p_corrected_category end, left(v_note, 500))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.photo_analysis_states(uuid) from public, anon, authenticated;
revoke all on function public.review_visual_analysis(uuid, public.visual_review_decision, public.complaint_category, text)
  from public, anon, authenticated;
grant execute on function public.photo_analysis_states(uuid) to authenticated;
grant execute on function public.review_visual_analysis(uuid, public.visual_review_decision, public.complaint_category, text)
  to authenticated;
