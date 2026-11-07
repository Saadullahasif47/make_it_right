-- Repair verification (Advanced Features plan v2 F4.01-F4.05, A5.01-A5.03): only the case's staff
-- add repair photos, photos are never replaced, the AI comparison never changes a case's status,
-- and a person's confirm or dispute settles the verification with an audit event.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

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
create function pg_temp.store_object(p_path text) returns void
language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('complaint-evidence', p_path, split_part(p_path, '/', 1),
          jsonb_build_object('size', 1000, 'mimetype', 'image/png'));
$$;

create function pg_temp.case_of(p_ticket uuid) returns uuid
language sql as $$ select case_id from public.case_reports where complaint_id = p_ticket $$;
grant execute on function pg_temp.case_of(uuid) to authenticated, service_role;

create function pg_temp.claim() returns table (job_id uuid, msg_id bigint, attempt smallint)
language sql as $$ select c.job_id, c.msg_id, c.attempt from public.worker_claim_ai_jobs(1, 30) as c $$;
grant execute on function pg_temp.claim() to service_role;

create function pg_temp.version_of(p_ticket uuid) returns integer
language sql as $$ select version from public.complaints where id = p_ticket $$;
grant execute on function pg_temp.version_of(uuid) to authenticated;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('ad000000-0000-4000-8000-00000000000a', 'rv.reporter@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('bd000000-0000-4000-8000-00000000000b', 'rv.other@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('cd000000-0000-4000-8000-00000000000c', 'rv.furniture@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('dd000000-0000-4000-8000-00000000000d', 'rv.plumbing@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ed000000-0000-4000-8000-00000000000e', 'rv.admin@makeitright.test', 'authenticated', 'authenticated', '{}');
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'furniture')
 where id = 'cd000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'plumbing')
 where id = 'dd000000-0000-4000-8000-00000000000d';
update public.profiles set role = 'admin' where id = 'ed000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid, path text);
grant all on t to authenticated, service_role;

select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
insert into t (name, id) select 'ticket', r.id from public.create_ticket('Chair broken', 'The chair leg is cracked.', 'Rv Hall', 'R1', gen_random_uuid()) as r;
insert into t (name, id) select 'unrouted', r.id from public.create_ticket('Desk wobbly', 'The desk wobbles a lot.', 'Rv Hall', 'R2', gen_random_uuid()) as r;
insert into t (name, id) select 'bare', r.id from public.create_ticket('Door stuck', 'The door does not close.', 'Rv Hall', 'R3', gen_random_uuid()) as r;
select pg_temp.act_as('ed000000-0000-4000-8000-00000000000e');
select public.assign_ticket((select id from t where name = 'ticket'), (select id from public.departments where code = 'furniture'), 'furniture', 'medium', 1);
select public.assign_ticket((select id from t where name = 'bare'), (select id from public.departments where code = 'furniture'), 'furniture', 'medium', 1);
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
select public.transition_ticket((select id from t where name = 'ticket'), 'in_progress', pg_temp.version_of((select id from t where name = 'ticket')));
select public.transition_ticket((select id from t where name = 'bare'), 'in_progress', pg_temp.version_of((select id from t where name = 'bare')));
reset role;
insert into t (name, id) select 'case', pg_temp.case_of((select id from t where name = 'ticket'));
insert into t (name, id) select 'bare_case', pg_temp.case_of((select id from t where name = 'bare'));

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants
            where table_name in ('repair_evidence', 'verification_reviews')
              and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0,
  'API roles can only read repair evidence and verifications');
select ok(
  not has_function_privilege('authenticated', 'public.worker_verification_context(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_save_verification(uuid, bigint, smallint, text, text, jsonb)', 'execute'),
  'signed-in users cannot run the verification worker functions'
);

-- ---------------------------------------------------------------------------------------------
-- Who may upload (F4.01, A5.01)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'after', 'image/png', 1000) $$,
  (select id from t where name = 'case')), 'MR403', null, 'a reporter cannot add repair photos');
select pg_temp.act_as('dd000000-0000-4000-8000-00000000000d');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'before', 'image/png', 1000) $$,
  (select id from t where name = 'case')), 'MR404', null, 'another department cannot see the case');
select pg_temp.act_as('ed000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'before', 'image/png', 1000) $$,
  pg_temp.case_of((select id from t where name = 'unrouted'))), 'MR422', null, 'an unrouted case takes no repair photos');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'before', 'image/png', 1000) $$,
  (select id from public.maintenance_cases where is_synthetic limit 1)), 'MR404', null, 'synthetic history takes no photos');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'before', 'image/gif', 1000) $$,
  (select id from t where name = 'case')), '22023', null, 'only JPEG, PNG and WebP');

select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
insert into t (name, id, path)
select 'before', r.attachment_id, r.object_path
  from public.request_repair_evidence_upload((select id from t where name = 'case'), 'before', 'image/png', 1000) as r;
reset role;
select pg_temp.store_object((select path from t where name = 'before'));
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
select is((select review_id from public.finalize_repair_evidence_upload((select id from t where name = 'before'), repeat('a', 64), 1000, 'image/png')),
  null, 'a before photo opens no verification');
reset role;
select is((select count(*)::int from public.case_events
            where case_id = (select id from t where name = 'case') and event_type = 'repair_evidence_added'), 1,
  'adding a repair photo is an event on the case');

select pgmq.purge_queue('makeitright_ai_jobs');
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
insert into t (name, id, path)
select 'after', r.attachment_id, r.object_path
  from public.request_repair_evidence_upload((select id from t where name = 'case'), 'after', 'image/png', 1000) as r;
reset role;
select pg_temp.store_object((select path from t where name = 'after'));
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
create temp table fin as select * from public.finalize_repair_evidence_upload((select id from t where name = 'after'), repeat('b', 64), 1000, 'image/png');
grant all on fin to authenticated, service_role;
select isnt((select review_id from fin), null, 'an after photo opens a verification');
select isnt((select job_id from fin), null, 'and queues the comparison');
select is((select review_id from public.finalize_repair_evidence_upload((select id from t where name = 'after'), repeat('b', 64), 1000, 'image/png')),
  (select review_id from fin), 'finalising again returns the same verification');
select throws_ok(format($$ select * from public.request_repair_evidence_upload(%L, 'after', 'image/png', 1000) $$,
  (select id from t where name = 'case')), 'MR422', null, 'a second after photo waits until the first is decided');
reset role;
select results_eq(
  format($$ select state::text, before_attachment_id from public.verification_reviews where id = %L $$, (select review_id from fin)),
  format($$ values ('pending', %L::uuid) $$, (select id from t where name = 'before')),
  'the comparison uses the staff before photo');
select throws_ok(
  format($$ update public.repair_evidence set evidence_kind = 'before' where attachment_id = %L $$, (select id from t where name = 'after')),
  '42501', null, 'repair photos are never relabelled or replaced');

-- ---------------------------------------------------------------------------------------------
-- Who may see it (F4.04)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.verification_reviews), 1, 'the reporter sees the verification of their case');
select is((select count(*)::int from public.evidence_attachments where case_id = (select id from t where name = 'case')), 2,
  'and its repair photos');
select isnt(public.repair_verification_view((select id from t where name = 'ticket')), null, 'the reporter gets the verification view');
select is((select count(*)::int from public.case_reports), 0, 'reporters still cannot list case links (A0)');
select pg_temp.act_as('bd000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.verification_reviews), 0, 'another student sees no verification');
select is((select count(*)::int from public.evidence_attachments where case_id = (select id from t where name = 'case')), 0,
  'nor its photos');
select is(public.repair_verification_view((select id from t where name = 'ticket')), null, 'nor its view');
select pg_temp.act_as('dd000000-0000-4000-8000-00000000000d');
select is((select count(*)::int from public.verification_reviews), 0, 'another department sees no verification');
reset role;

-- ---------------------------------------------------------------------------------------------
-- The AI result is a suggestion only (F4.03, F4.05)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table claimed as select * from pg_temp.claim();
grant all on claimed to service_role;
select is((select job_id from claimed), (select job_id from fin), 'the worker claims the comparison');
select is(
  public.worker_save_verification((select job_id from claimed), (select msg_id from claimed), 1::smallint, 'verify-v1', 'gemini-test',
    '{"ai_status":"visually_improved","uncertainty_flags":["PARTLY_NOT_VISIBLE"],"explanation":"The visible crack appears gone.",
      "before_observations":["A cracked leg"],"after_observations":["A whole leg"],"visible_changes":["The crack is gone"],
      "not_visible_or_uncertain":["Whether it holds weight"]}'::jsonb) ->> 'ai_status',
  'visually_improved', 'the worker stores the comparison');
select is(
  public.worker_save_verification((select job_id from claimed), (select msg_id from claimed), 1::smallint, 'verify-v1', 'gemini-test',
    '{"ai_status":"possibly_unresolved","uncertainty_flags":[],"explanation":"Retry."}'::jsonb) ->> 'ai_status',
  'visually_improved', 'a retried job keeps the first result');
reset role;
select is((select status::text from public.maintenance_cases where id = (select id from t where name = 'case')), 'in_progress',
  'a "visually improved" result never moves the case');
select is((select status::text from public.complaints where id = (select id from t where name = 'ticket')), 'in_progress',
  'nor the report');
select is((select state::text from public.verification_reviews where id = (select review_id from fin)), 'awaiting_decision',
  'the verification now waits for a person');

-- ---------------------------------------------------------------------------------------------
-- A person decides (F4.04-F4.05, A5.03)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
select throws_ok(format($$ select public.decide_repair_verification(%L, true) $$, (select review_id from fin)),
  'MR403', null, 'the department cannot confirm its own repair');
select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
select throws_ok(format($$ select public.decide_repair_verification(%L, true) $$, (select review_id from fin)),
  'MR422', null, 'nothing to confirm before the department resolves the ticket');
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
select public.transition_ticket((select id from t where name = 'ticket'), 'resolved',
  pg_temp.version_of((select id from t where name = 'ticket')), 'Replaced the chair leg.');
select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
select is(public.decide_repair_verification((select review_id from fin), false, 'It still wobbles badly.')::text, 'reopened',
  'the reporter disputes the repair and the case reopens');
reset role;
select results_eq(
  format($$ select state::text, decided_by, decision_note from public.verification_reviews where id = %L $$, (select review_id from fin)),
  $$ values ('rework', 'ad000000-0000-4000-8000-00000000000a'::uuid, 'It still wobbles badly.') $$,
  'the dispute settles the verification with who and why');
select is((select count(*)::int from public.case_work_orders where case_id = (select id from t where name = 'case') and status = 'active'), 1,
  'the work order is still active after the dispute');
select is((select count(*)::int from public.repair_evidence where case_id = (select id from t where name = 'case')), 2,
  'and no photo was lost');
select pg_temp.act_as('ad000000-0000-4000-8000-00000000000a');
select throws_ok(format($$ select public.decide_repair_verification(%L, true) $$, (select review_id from fin)),
  'MR412', null, 'a settled verification cannot be decided again');
reset role;

-- Without a before photo there is nothing to compare: the view says so, nothing closes.
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
insert into t (name, id, path)
select 'bare_after', r.attachment_id, r.object_path
  from public.request_repair_evidence_upload((select id from t where name = 'bare_case'), 'after', 'image/png', 1000) as r;
reset role;
select pg_temp.store_object((select path from t where name = 'bare_after'));
select pg_temp.act_as('cd000000-0000-4000-8000-00000000000c');
select is((select v.before_attachment_id from public.finalize_repair_evidence_upload((select id from t where name = 'bare_after'), repeat('c', 64), 1000, 'image/png') as f
             join public.verification_reviews as v on v.id = f.review_id), null,
  'a case without any before photo gets a verification with no before photo');

-- An administrator closes the whole case after the department resolves it.
select public.transition_ticket((select id from t where name = 'bare'), 'resolved',
  pg_temp.version_of((select id from t where name = 'bare')), 'Planed the door edge.');
select pg_temp.act_as('ed000000-0000-4000-8000-00000000000e');
select is(public.decide_repair_verification(
  (select id from public.verification_reviews where case_id = (select id from t where name = 'bare_case')), true)::text,
  'closed', 'an administrator confirms and the case closes');
reset role;
select is((select state::text from public.verification_reviews where case_id = (select id from t where name = 'bare_case')), 'confirmed',
  'the verification records the confirmation');

select * from finish();
rollback;
