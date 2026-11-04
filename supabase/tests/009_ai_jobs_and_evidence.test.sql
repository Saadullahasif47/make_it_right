-- Evidence storage and the durable AI job pipeline (Advanced Features plan v2 F1.01, F1.02,
-- A1.01-A1.04, §05). Uploads are reserved, checked and finalised; jobs are claimed, retried,
-- redelivered and reviewed exactly as the worker would drive them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(71);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_service() to authenticated, service_role;

-- What Storage would have written after a successful upload.
create function pg_temp.store_object(p_path text, p_size integer, p_mime text) returns void
language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('complaint-evidence', p_path, split_part(p_path, '/', 1),
          jsonb_build_object('size', p_size, 'mimetype', p_mime));
$$;

create function pg_temp.job(p_id uuid) returns public.ai_jobs
language sql as $$ select * from public.ai_jobs where id = p_id $$;

create function pg_temp.queued_messages() returns bigint
language sql as $$ select count(*) from pgmq.q_makeitright_ai_jobs $$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a9000000-0000-4000-8000-00000000000a', 'ev.owner@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"EV Owner"}'),
  ('b9000000-0000-4000-8000-00000000000b', 'ev.other@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"EV Other"}'),
  ('e9000000-0000-4000-8000-00000000000e', 'ev.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"EV Admin"}');
update public.profiles set role = 'admin' where id = 'e9000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid, path text);
grant all on t to authenticated, service_role;

select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
insert into t (name, id) select 'ticket', r.id
  from public.create_ticket('Evidence ticket', 'A ticket that receives photo evidence.', 'Block E', '1', gen_random_uuid()) as r;
reset role;

-- ---------------------------------------------------------------------------------------------
-- The bucket and Storage policies (F1.01)
-- ---------------------------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'complaint-evidence'), false, 'the evidence bucket is private');
select is((select file_size_limit from storage.buckets where id = 'complaint-evidence'), 2097152::bigint,
  'the bucket caps files at 2 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'complaint-evidence'),
  array['image/jpeg', 'image/png', 'image/webp'], 'the bucket accepts only JPEG, PNG and WebP');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'evidence_%'),
  array['evidence_objects_delete_unfinalized', 'evidence_objects_insert_pending', 'evidence_objects_select_visible'],
  'evidence objects can be inserted, read and discarded, but never updated'
);

-- ---------------------------------------------------------------------------------------------
-- Reserving an upload (F1.02)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
insert into t (name, id, path)
select 'photo', r.attachment_id, r.object_path
  from public.request_evidence_upload((select id from t where name = 'ticket'), 'image/png', 1000) as r;
select matches((select path from t where name = 'photo'),
  '^a9000000-0000-4000-8000-00000000000a/[0-9a-f-]{36}\.png$', 'the object path is inside the uploader''s own folder');
select is((select state::text from public.evidence_attachments where id = (select id from t where name = 'photo')), 'pending',
  'a reserved photo starts pending');
select ok(private.can_upload_evidence((select path from t where name = 'photo')),
  'the uploader may write exactly that object');
select ok(not private.can_upload_evidence('a9000000-0000-4000-8000-00000000000a/a9000000-0000-4000-8000-000000000999.png'),
  'an unreserved path in the same folder cannot be written');

select throws_ok(format($$ select * from public.request_evidence_upload(%L, 'image/gif', 1000) $$, (select id from t where name = 'ticket')),
  '22023', null, 'a GIF cannot be reserved');
select throws_ok(format($$ select * from public.request_evidence_upload(%L, 'image/png', 2097153) $$, (select id from t where name = 'ticket')),
  'MR413', null, 'a photo over 2 MiB cannot be reserved');

select pg_temp.act_as('b9000000-0000-4000-8000-00000000000b');
select throws_ok(format($$ select * from public.request_evidence_upload(%L, 'image/png', 1000) $$, (select id from t where name = 'ticket')),
  'MR404', null, 'another student cannot add photos to someone else''s ticket');
select ok(not private.can_upload_evidence((select path from t where name = 'photo')),
  'another student cannot write the reserved object');
select ok(not private.can_read_evidence((select path from t where name = 'photo')),
  'another student cannot read the pending object');

select pg_temp.act_as('e9000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select * from public.request_evidence_upload(%L, 'image/png', 1000) $$, (select id from t where name = 'ticket')),
  'MR404', null, 'only the reporter adds photos to a report, not an admin');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Finalising (checks the stored object, then queues the analysis in the same transaction)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, repeat('a', 64), 1000, 'image/png') $$, (select id from t where name = 'photo')),
  'MR404', null, 'an upload with no stored object (an orphaned reference) cannot be finalised'
);
reset role;
select pg_temp.store_object((select path from t where name = 'photo'), 999, 'image/png');

select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, repeat('a', 64), 1000, 'image/png') $$, (select id from t where name = 'photo')),
  'MR400', null, 'a stored object whose size differs from the request is refused'
);
reset role;
update storage.objects set metadata = jsonb_build_object('size', 1000, 'mimetype', 'image/png')
 where name = (select path from t where name = 'photo');

select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, 'not-a-hash', 1000, 'image/png') $$, (select id from t where name = 'photo')),
  'MR400', null, 'a malformed checksum is refused'
);
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, repeat('a', 64), 1000, 'image/jpeg') $$, (select id from t where name = 'photo')),
  'MR400', null, 'a type that differs from the reservation is refused'
);

select pg_temp.act_as('b9000000-0000-4000-8000-00000000000b');
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, repeat('a', 64), 1000, 'image/png') $$, (select id from t where name = 'photo')),
  'MR404', null, 'another student cannot finalise someone else''s upload'
);

select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
insert into t (name, id)
select 'job', r.job_id
  from public.finalize_evidence_upload((select id from t where name = 'photo'), repeat('a', 64), 1000, 'image/png') as r;
reset role;

select is((select state::text from public.evidence_attachments where id = (select id from t where name = 'photo')), 'finalized',
  'a matching upload is finalised');
select is((pg_temp.job((select id from t where name = 'job'))).status::text, 'queued', 'finalising queues a job');
select is((pg_temp.job((select id from t where name = 'job'))).job_type::text, 'visual_analysis', 'the job is the photo''s visual analysis');
select is((pg_temp.job((select id from t where name = 'job'))).target_id, (select id from t where name = 'photo'),
  'the job targets the photo');
select is(
  (select message from pgmq.q_makeitright_ai_jobs where msg_id = (pg_temp.job((select id from t where name = 'job'))).queue_msg_id),
  jsonb_build_object('job_id', (select id from t where name = 'job')),
  'the queue message carries only the job id'
);

select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select is(
  (select r.job_id from public.finalize_evidence_upload((select id from t where name = 'photo'), repeat('a', 64), 1000, 'image/png') as r),
  (select id from t where name = 'job'),
  'finalising again returns the same job (idempotent)'
);
reset role;
select is((select count(*)::int from public.ai_jobs where target_id = (select id from t where name = 'photo')), 1,
  'a repeated finalise creates no second job');

select pg_temp.act_as('b9000000-0000-4000-8000-00000000000b');
select ok(not private.can_read_evidence((select path from t where name = 'photo')),
  'another student cannot read the finalised photo');
select pg_temp.act_as('e9000000-0000-4000-8000-00000000000e');
select ok(private.can_read_evidence((select path from t where name = 'photo')), 'an admin can read the finalised photo');
select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select ok(not private.can_discard_evidence((select path from t where name = 'photo')),
  'a finalised photo cannot be deleted by its uploader');
select throws_ok(format($$ select public.discard_evidence_upload(%L) $$, (select id from t where name = 'photo')),
  'MR422', null, 'a finalised photo cannot be discarded');

-- Discarding a bad upload.
insert into t (name, id, path)
select 'bad', r.attachment_id, r.object_path
  from public.request_evidence_upload((select id from t where name = 'ticket'), 'image/jpeg', 500) as r;
select lives_ok(format($$ select public.discard_evidence_upload(%L) $$, (select id from t where name = 'bad')),
  'the uploader can discard an unfinished upload');
select ok(not private.can_upload_evidence((select path from t where name = 'bad')),
  'a discarded reservation can no longer be uploaded to');
select throws_ok(
  format($$ select * from public.finalize_evidence_upload(%L, repeat('a', 64), 500, 'image/jpeg') $$, (select id from t where name = 'bad')),
  'MR422', null, 'a discarded upload cannot be finalised'
);

-- Limits: five photos per complaint.
select lives_ok(format($$ select (public.request_evidence_upload(%L, 'image/png', 10)).attachment_id from generate_series(1, 4) $$,
  (select id from t where name = 'ticket')), 'up to five photos can be reserved for one complaint');
select throws_ok(format($$ select * from public.request_evidence_upload(%L, 'image/png', 10) $$, (select id from t where name = 'ticket')),
  'MR429', null, 'a sixth photo is refused');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Worker functions: service role only (A1.02)
-- ---------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.worker_claim_ai_jobs(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_complete_ai_job(uuid, bigint, smallint)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_fail_ai_job(uuid, bigint, smallint, text, boolean, integer)', 'execute'),
  'signed-in users, admins included, cannot run the worker functions'
);
select ok(has_function_privilege('service_role', 'public.worker_claim_ai_jobs(integer, integer)', 'execute'),
  'the service role can claim jobs');
select ok(not has_function_privilege('authenticated', 'private.enqueue_ai_job(public.ai_job_type, uuid, text)', 'execute'),
  'signed-in users cannot enqueue jobs directly');

-- Start from an empty queue so the claims below see only this test's messages.
select pgmq.purge_queue('makeitright_ai_jobs');
insert into t (name, id) values ('j1', private.enqueue_ai_job('embedding', gen_random_uuid(), 'pgtap-job-1'));
select is(private.enqueue_ai_job('embedding', gen_random_uuid(), 'pgtap-job-1'), (select id from t where name = 'j1'),
  'enqueueing the same dedupe key returns the existing job');
select is(pg_temp.queued_messages(), 1::bigint, 'and sends no second message');

-- ---------------------------------------------------------------------------------------------
-- Lifecycle: claim, retry, exhaust (plan §05)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table c1 as select * from public.worker_claim_ai_jobs(1, 30);
select is((select count(*)::int from c1), 1, 'one message is claimed');
select is((select attempt from c1), 1::smallint, 'the first claim is attempt 1');
select is(
  (select count(*)::int from public.worker_claim_ai_jobs(1, 30)), 0,
  'a claimed message is hidden from a second worker'
);
reset role;
select is((pg_temp.job((select id from t where name = 'j1'))).status::text, 'running', 'a claimed job is running');

select pg_temp.act_as_service();
select is(public.worker_fail_ai_job((select job_id from c1), (select msg_id from c1), 1::smallint, 'RATE_LIMITED', true, 0),
  'retry_wait'::public.ai_job_status, 'a rate-limited attempt waits to retry');
reset role;
select ok((pg_temp.job((select id from t where name = 'j1'))).next_retry_at is not null, 'the retry time is recorded');

select pg_temp.act_as_service();
create temp table c2 as select * from public.worker_claim_ai_jobs(1, 30);
select is((select attempt from c2), 2::smallint, 'the retry is attempt 2 of the same message');
select throws_ok(
  format($$ select public.worker_complete_ai_job(%L, %s, 1::smallint) $$, (select job_id from c2), (select msg_id from c2)),
  'MR412', null, 'a late report from attempt 1 is refused once attempt 2 holds the job'
);
select is(public.worker_fail_ai_job((select job_id from c2), (select msg_id from c2), 2::smallint, 'RATE_LIMITED', true, 0),
  'retry_wait'::public.ai_job_status, 'attempt 2 also waits to retry');
create temp table c3 as select * from public.worker_claim_ai_jobs(1, 30);
select is(public.worker_fail_ai_job((select job_id from c3), (select msg_id from c3), 3::smallint, 'RATE_LIMITED', true, 0),
  'needs_review'::public.ai_job_status, 'after three attempts a retryable failure goes to review (simulated 429)');
reset role;
select is((pg_temp.job((select id from t where name = 'j1'))).last_error_code, 'RATE_LIMITED', 'the failure code is kept');
select is(pg_temp.queued_messages(), 0::bigint, 'a job in review leaves no message in the queue');

-- A non-retryable failure goes to review at once.
insert into t (name, id) values ('j2', private.enqueue_ai_job('embedding', gen_random_uuid(), 'pgtap-job-2'));
select pg_temp.act_as_service();
create temp table c4 as select * from public.worker_claim_ai_jobs(1, 30);
select is(public.worker_fail_ai_job((select job_id from c4), (select msg_id from c4), 1::smallint, 'INVALID_OUTPUT', false, 0),
  'needs_review'::public.ai_job_status, 'a non-retryable failure goes to review on the first attempt');
reset role;

-- Success, then a redelivery of the same work does nothing.
insert into t (name, id) values ('j3', private.enqueue_ai_job('embedding', gen_random_uuid(), 'pgtap-job-3'));
select pg_temp.act_as_service();
create temp table c5 as select * from public.worker_claim_ai_jobs(1, 30);
select is(public.worker_complete_ai_job((select job_id from c5), (select msg_id from c5), 1::smallint),
  'succeeded'::public.ai_job_status, 'a successful attempt completes the job');
select is(public.worker_complete_ai_job((select job_id from c5), (select msg_id from c5), 1::smallint),
  'succeeded'::public.ai_job_status, 'reporting success twice is harmless');
reset role;
select pgmq.send('makeitright_ai_jobs', jsonb_build_object('job_id', (select id from t where name = 'j3')));
select pgmq.send('makeitright_ai_jobs', '{"job_id":"not-a-uuid"}'::jsonb);
select pg_temp.act_as_service();
select is((select count(*)::int from public.worker_claim_ai_jobs(5, 30)), 0,
  'a redelivered message for finished work, or a malformed message, is dropped without running');
reset role;
select is(pg_temp.queued_messages(), 0::bigint, 'dropped messages are archived');
select is((pg_temp.job((select id from t where name = 'j3'))).attempts, 1::smallint, 'the finished job is not attempted again');

-- A worker that dies mid-job: its message reappears and counts as a failed attempt.
insert into t (name, id) values ('j4', private.enqueue_ai_job('embedding', gen_random_uuid(), 'pgtap-job-4'));
update public.ai_jobs set attempts = 3, status = 'running' where id = (select id from t where name = 'j4');
select pg_temp.act_as_service();
select is((select count(*)::int from public.worker_claim_ai_jobs(1, 30)), 0,
  'a job whose last attempt never reported back is not run a fourth time');
reset role;
select is((pg_temp.job((select id from t where name = 'j4'))).status::text, 'needs_review', 'it goes to review');
select is((pg_temp.job((select id from t where name = 'j4'))).last_error_code, 'WORKER_TIMEOUT', 'with a worker-timeout code');

-- ---------------------------------------------------------------------------------------------
-- Admin retry (A1.04)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a9000000-0000-4000-8000-00000000000a');
select throws_ok(format($$ select * from public.admin_retry_ai_job(%L) $$, (select id from t where name = 'j1')),
  'MR403', null, 'a student cannot retry a job');
select is((select count(*)::int from public.ai_jobs), 0, 'a student cannot read AI jobs');
select pg_temp.act_as('e9000000-0000-4000-8000-00000000000e');
select is((select r.status::text from public.admin_retry_ai_job((select id from t where name = 'j1')) as r), 'queued',
  'an admin can queue a reviewed job again');
select throws_ok(format($$ select * from public.admin_retry_ai_job(%L) $$, (select id from t where name = 'j1')),
  'MR422', null, 'only a job waiting for review can be retried');
reset role;
select is((pg_temp.job((select id from t where name = 'j1'))).attempts, 0::smallint, 'a retried job gets a fresh attempt budget');
select is(pg_temp.queued_messages(), 1::bigint, 'and a new queue message');

update public.ai_jobs set status = 'needs_review', admin_retries = 3, queue_msg_id = null
 where id = (select id from t where name = 'j1');
select pg_temp.act_as('e9000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select * from public.admin_retry_ai_job(%L) $$, (select id from t where name = 'j1')),
  'MR429', null, 'an admin can retry a job at most three times');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Scheduling (A1.03)
-- ---------------------------------------------------------------------------------------------
select is((select schedule from cron.job where jobname = 'makeitright-ai-worker'), '* * * * *',
  'Supabase Cron wakes the worker every minute');
select is(private.invoke_ai_worker(), null::bigint, 'without the Vault secrets nothing is sent');
select ok(not has_function_privilege('authenticated', 'private.invoke_ai_worker()', 'execute'),
  'signed-in users cannot trigger the worker');

select * from finish();
rollback;
