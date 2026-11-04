-- MakeItRight add-on A1: private evidence storage and the durable AI job pipeline
-- (Advanced Features plan v2 §05, F1.01, F1.02, A1.01-A1.04).
--
--   * Photos go to a private bucket by a signed direct upload, then are finalised. The
--     attachment row exists before any byte is uploaded, so Storage policies can tie every
--     object to exactly one pending row owned by the uploader. Nothing is ever public.
--   * A finalised photo enqueues its analysis in the same transaction: an ai_jobs row plus a
--     pgmq message that carries only the job id (plan §05). A complaint never waits for AI.
--   * One Edge Function consumes the queue (Supabase Cron calls it every minute while work is
--     pending). Its three functions are service-role only. Each attempt is bounded: three per
--     job, with retries after a backoff the worker chooses; then the job waits for an admin.
--   * A worker that dies mid-job leaves its message to reappear after the visibility timeout;
--     the next claim counts that as a failed attempt. A redelivered message for a finished job
--     is archived and ignored, so no side effect runs twice through this pipeline.

-- ---------------------------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Private evidence bucket (F1.01): JPEG/PNG/WebP, 2 MiB, never public
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complaint-evidence', 'complaint-evidence', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- How long a requested upload may take before it can no longer be completed.
create function private.evidence_upload_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 minutes' $$;

-- Storage policy helpers. They run as the caller, so evidence_attachments RLS still applies:
-- a row the caller cannot see never authorises anything.
create function private.can_upload_evidence(p_object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_attachments as a
     where a.object_path = p_object_name
       and a.uploaded_by = (select auth.uid())
       and a.state = 'pending'
       and a.created_at > now() - private.evidence_upload_window()
  );
$$;

create function private.can_read_evidence(p_object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_attachments as a
     where a.object_path = p_object_name
       and (a.state = 'finalized' or a.uploaded_by = (select auth.uid()))
  );
$$;

create function private.can_discard_evidence(p_object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_attachments as a
     where a.object_path = p_object_name
       and a.uploaded_by = (select auth.uid())
       and a.state <> 'finalized'
  );
$$;

revoke all on function private.evidence_upload_window() from public, anon, authenticated;
revoke all on function private.can_upload_evidence(text) from public, anon, authenticated;
revoke all on function private.can_read_evidence(text) from public, anon, authenticated;
revoke all on function private.can_discard_evidence(text) from public, anon, authenticated;
grant execute on function private.evidence_upload_window() to authenticated;
grant execute on function private.can_upload_evidence(text) to authenticated;
grant execute on function private.can_read_evidence(text) to authenticated;
grant execute on function private.can_discard_evidence(text) to authenticated;

-- Upload: only into a pending row's exact path. No UPDATE policy exists, so an object can never
-- be replaced once written; deleting is limited to the uploader's unfinalised objects.
create policy evidence_objects_insert_pending
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'complaint-evidence' and private.can_upload_evidence(name));

create policy evidence_objects_select_visible
  on storage.objects for select
  to authenticated
  using (bucket_id = 'complaint-evidence' and private.can_read_evidence(name));

create policy evidence_objects_delete_unfinalized
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'complaint-evidence' and private.can_discard_evidence(name));

-- ---------------------------------------------------------------------------------------------
-- Durable queue and job bookkeeping (A1.02)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pgmq.list_queues() as q where q.queue_name = 'makeitright_ai_jobs') then
    perform pgmq.create('makeitright_ai_jobs');
  end if;
end;
$$;

alter table public.ai_jobs
  add column queue_msg_id bigint,
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add column admin_retries smallint not null default 0
    constraint ai_jobs_admin_retries_range check (admin_retries between 0 and 3);

comment on column public.ai_jobs.queue_msg_id is 'The pgmq message that currently carries this job.';

-- Attempts per job before it waits for an administrator (plan §05: bounded, 3 attempts).
create function private.ai_job_max_attempts()
returns smallint
language sql
immutable
set search_path = ''
as $$ select 3::smallint $$;

revoke all on function private.ai_job_max_attempts() from public, anon, authenticated;

-- Records a job and queues its message in the caller's transaction. A repeated dedupe key
-- returns the existing job and sends nothing.
create function private.enqueue_ai_job(p_type public.ai_job_type, p_target uuid, p_dedupe_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  insert into public.ai_jobs (job_type, target_id, dedupe_key)
  values (p_type, p_target, p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select j.id into strict v_job_id from public.ai_jobs as j where j.dedupe_key = p_dedupe_key;
    return v_job_id;
  end if;

  update public.ai_jobs
     set queue_msg_id = (select pgmq.send('makeitright_ai_jobs', jsonb_build_object('job_id', v_job_id)))
   where id = v_job_id;
  return v_job_id;
end;
$$;

revoke all on function private.enqueue_ai_job(public.ai_job_type, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Evidence upload functions (F1.02), called with the signed-in user's token
-- ---------------------------------------------------------------------------------------------
create function public.request_evidence_upload(p_complaint_id uuid, p_mime_type text, p_byte_size integer)
returns table (attachment_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_complaint public.complaints;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_actor is null then
    raise exception 'not signed in' using errcode = '42501';
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

  -- One lock per user serialises the limits below, as create_ticket does (ADR 0003).
  perform pg_advisory_xact_lock(hashtextextended('evidence:' || v_actor::text, 0));

  select c.* into v_complaint from public.complaints as c where c.id = p_complaint_id;
  if not found or v_complaint.created_by <> v_actor then
    -- Someone else's ticket is indistinguishable from a missing one.
    raise exception 'complaint not found' using errcode = 'MR404';
  end if;
  if v_complaint.status = 'closed' then
    raise exception 'complaint is closed' using errcode = 'MR422';
  end if;

  if (select count(*) from public.evidence_attachments as a
       where a.complaint_id = p_complaint_id and a.state <> 'rejected') >= 5 then
    raise exception 'photo limit reached for this complaint' using errcode = 'MR429';
  end if;
  if (select count(*) from public.evidence_attachments as a
       where a.uploaded_by = v_actor and a.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'upload rate limit' using errcode = 'MR429';
  end if;

  v_path := v_actor::text || '/' || v_id::text || '.' || case p_mime_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;

  insert into public.evidence_attachments (id, complaint_id, uploaded_by, object_path, mime_type, byte_size)
  values (v_id, p_complaint_id, v_actor, v_path, p_mime_type, p_byte_size);

  return query select v_id, v_path;
end;
$$;

-- Completes an upload once the server has checked the bytes. The object must exist in the
-- bucket with exactly the declared size and type; then the photo is finalised and its visual
-- analysis queued, in one transaction. Repeating it returns the same job.
create function public.finalize_evidence_upload(
  p_attachment_id uuid,
  p_sha256 text,
  p_byte_size integer,
  p_mime_type text
)
returns table (attachment_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_attachment public.evidence_attachments;
  v_object storage.objects;
  v_job_id uuid;
begin
  if v_actor is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select a.* into v_attachment from public.evidence_attachments as a
   where a.id = p_attachment_id
     for update;
  if not found or v_attachment.uploaded_by <> v_actor or v_attachment.complaint_id is null then
    raise exception 'upload not found' using errcode = 'MR404';
  end if;

  if v_attachment.state = 'finalized' then
    select j.id into v_job_id from public.ai_jobs as j
     where j.dedupe_key = 'visual_analysis:' || v_attachment.id::text;
    return query select v_attachment.id, v_job_id;
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
    -- An orphaned reference: the row exists but nothing was uploaded.
    raise exception 'uploaded object not found' using errcode = 'MR404';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_byte_size is distinct from v_attachment.byte_size
     or p_mime_type is distinct from v_attachment.mime_type
     or (v_object.metadata ->> 'size')::bigint is distinct from v_attachment.byte_size::bigint
     or (v_object.metadata ->> 'mimetype') is distinct from v_attachment.mime_type then
    raise exception 'uploaded object does not match the request' using errcode = 'MR400';
  end if;

  update public.evidence_attachments as a
     set state = 'finalized', finalized_at = now(), sha256 = p_sha256
   where a.id = v_attachment.id;

  v_job_id := private.enqueue_ai_job('visual_analysis', v_attachment.id, 'visual_analysis:' || v_attachment.id::text);
  return query select v_attachment.id, v_job_id;
end;
$$;

-- Marks the caller's unfinished upload as rejected (bad bytes, or the user gave up).
create function public.discard_evidence_upload(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.evidence_attachments;
begin
  select a.* into v_attachment from public.evidence_attachments as a
   where a.id = p_attachment_id
     for update;
  if not found or v_attachment.uploaded_by is distinct from (select auth.uid()) then
    raise exception 'upload not found' using errcode = 'MR404';
  end if;
  if v_attachment.state = 'finalized' then
    raise exception 'a finalised photo cannot be discarded' using errcode = 'MR422';
  end if;
  update public.evidence_attachments set state = 'rejected' where id = v_attachment.id;
end;
$$;

revoke all on function public.request_evidence_upload(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finalize_evidence_upload(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.discard_evidence_upload(uuid) from public, anon, authenticated;
grant execute on function public.request_evidence_upload(uuid, text, integer) to authenticated;
grant execute on function public.finalize_evidence_upload(uuid, text, integer, text) to authenticated;
grant execute on function public.discard_evidence_upload(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Worker functions (A1.02, A1.03): service role only, never a signed-in user
-- ---------------------------------------------------------------------------------------------
create function public.worker_claim_ai_jobs(p_batch integer default 1, p_visibility_seconds integer default 90)
returns table (job_id uuid, msg_id bigint, job_type public.ai_job_type, target_id uuid, attempt smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_job public.ai_jobs;
  v_job_id uuid;
begin
  if p_batch is null or p_batch not between 1 and 10
     or p_visibility_seconds is null or p_visibility_seconds not between 1 and 600 then
    raise exception 'invalid claim bounds' using errcode = '22023';
  end if;

  for v_message in
    select m.msg_id, m.message from pgmq.read('makeitright_ai_jobs', p_visibility_seconds, p_batch) as m
  loop
    v_job_id := null;
    if jsonb_typeof(v_message.message -> 'job_id') = 'string'
       and (v_message.message ->> 'job_id') ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      v_job_id := (v_message.message ->> 'job_id')::uuid;
    end if;

    select j.* into v_job from public.ai_jobs as j where j.id = v_job_id for update;
    if not found or v_job.status in ('succeeded', 'needs_review') then
      -- A malformed message, or a redelivery of finished work: drop it, run nothing.
      perform pgmq.archive('makeitright_ai_jobs', v_message.msg_id);
      continue;
    end if;

    if v_job.attempts >= private.ai_job_max_attempts() then
      -- The last attempt never reported back (its worker stopped): stop here.
      update public.ai_jobs as j
         set status = 'needs_review', next_retry_at = null, finished_at = now(),
             last_error_code = case when v_job.status = 'running' then 'WORKER_TIMEOUT' else 'ATTEMPTS_EXHAUSTED' end
       where j.id = v_job.id;
      perform pgmq.archive('makeitright_ai_jobs', v_message.msg_id);
      continue;
    end if;

    update public.ai_jobs as j
       set status = 'running', attempts = j.attempts + 1, next_retry_at = null,
           started_at = now(), queue_msg_id = v_message.msg_id,
           last_error_code = case when v_job.status = 'running' then 'WORKER_TIMEOUT' else j.last_error_code end
     where j.id = v_job.id
    returning j.* into v_job;

    return query select v_job.id, v_message.msg_id, v_job.job_type, v_job.target_id, v_job.attempts;
  end loop;
end;
$$;

-- Only the delivery that holds the job may report on it. A redelivered message keeps its
-- msg_id, so the attempt number is the delivery token: a late report from an earlier attempt
-- is refused (MR412), and a timed-out worker can never overwrite a newer one.
create function private.lock_running_job(p_job_id uuid, p_msg_id bigint, p_attempt smallint)
returns public.ai_jobs
language plpgsql
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
begin
  select j.* into v_job from public.ai_jobs as j where j.id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'MR404';
  end if;
  if v_job.status <> 'running' or v_job.queue_msg_id is distinct from p_msg_id
     or v_job.attempts is distinct from p_attempt then
    raise exception 'job is not held by this delivery' using errcode = 'MR412';
  end if;
  return v_job;
end;
$$;

revoke all on function private.lock_running_job(uuid, bigint, smallint) from public, anon, authenticated;

create function public.worker_complete_ai_job(p_job_id uuid, p_msg_id bigint, p_attempt smallint)
returns public.ai_job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
begin
  select j.* into v_job from public.ai_jobs as j where j.id = p_job_id;
  if found and v_job.status = 'succeeded' then
    return 'succeeded';
  end if;
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);

  update public.ai_jobs as j
     set status = 'succeeded', finished_at = now(), last_error_code = null
   where j.id = v_job.id;
  perform pgmq.archive('makeitright_ai_jobs', p_msg_id);
  return 'succeeded';
end;
$$;

create function public.worker_fail_ai_job(
  p_job_id uuid,
  p_msg_id bigint,
  p_attempt smallint,
  p_error_code text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 60
)
returns public.ai_job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
begin
  if p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 600 then
    raise exception 'invalid retry delay' using errcode = '22023';
  end if;
  v_job := private.lock_running_job(p_job_id, p_msg_id, p_attempt);

  if p_retryable and v_job.attempts < private.ai_job_max_attempts() then
    update public.ai_jobs as j
       set status = 'retry_wait', last_error_code = p_error_code,
           next_retry_at = now() + make_interval(secs => p_retry_delay_seconds)
     where j.id = v_job.id;
    -- The same message becomes visible again after the delay: that is the retry.
    perform pgmq.set_vt('makeitright_ai_jobs', p_msg_id, p_retry_delay_seconds);
    return 'retry_wait';
  end if;

  update public.ai_jobs as j
     set status = 'needs_review', last_error_code = p_error_code, finished_at = now()
   where j.id = v_job.id;
  perform pgmq.archive('makeitright_ai_jobs', p_msg_id);
  return 'needs_review';
end;
$$;

revoke all on function public.worker_claim_ai_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.worker_complete_ai_job(uuid, bigint, smallint) from public, anon, authenticated;
revoke all on function public.worker_fail_ai_job(uuid, bigint, smallint, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.worker_claim_ai_jobs(integer, integer) to service_role;
grant execute on function public.worker_complete_ai_job(uuid, bigint, smallint) to service_role;
grant execute on function public.worker_fail_ai_job(uuid, bigint, smallint, text, boolean, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Admin retry (A1.04): a job waiting for review can be queued again, at most three times
-- ---------------------------------------------------------------------------------------------
create function public.admin_retry_ai_job(p_job_id uuid)
returns table (job_id uuid, status public.ai_job_status, admin_retries smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_jobs;
begin
  if (select private.current_app_role()) is distinct from 'admin' then
    raise exception 'admins only' using errcode = 'MR403';
  end if;

  select j.* into v_job from public.ai_jobs as j where j.id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'MR404';
  end if;
  if v_job.status <> 'needs_review' then
    raise exception 'only a job waiting for review can be retried' using errcode = 'MR422';
  end if;
  if v_job.admin_retries >= 3 then
    raise exception 'retry limit reached' using errcode = 'MR429';
  end if;

  update public.ai_jobs as j
     set status = 'queued', attempts = 0, admin_retries = j.admin_retries + 1,
         next_retry_at = null, started_at = null, finished_at = null,
         queue_msg_id = (select pgmq.send('makeitright_ai_jobs', jsonb_build_object('job_id', j.id)))
   where j.id = v_job.id
  returning j.* into v_job;

  return query select v_job.id, v_job.status, v_job.admin_retries;
end;
$$;

revoke all on function public.admin_retry_ai_job(uuid) from public, anon, authenticated;
grant execute on function public.admin_retry_ai_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Scheduling (A1.03): Supabase Cron wakes the worker every minute while work is pending.
-- The worker URL and secret are per-environment Vault secrets; without them nothing is sent,
-- so a fresh environment is safe until it is configured (runbook: cloud-environments.md).
-- ---------------------------------------------------------------------------------------------
create function private.invoke_ai_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.ai_jobs as j
     where j.status in ('queued', 'running')
        or (j.status = 'retry_wait' and j.next_retry_at <= now() + interval '1 minute')
  ) then
    return null;
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets as s where s.name = 'makeitright_ai_worker_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets as s where s.name = 'makeitright_ai_worker_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function private.invoke_ai_worker() from public, anon, authenticated;

select cron.schedule('makeitright-ai-worker', '* * * * *', 'select private.invoke_ai_worker()');
