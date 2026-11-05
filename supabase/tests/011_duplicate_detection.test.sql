-- Duplicate detection (Advanced Features plan v2 F2.01-F2.05, A3.01-A3.03): vectors are internal and
-- single-model, candidates are scoped and capped, and only an administrator links reports.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

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

-- A unit vector along one axis; equal axes give cosine 1, different axes 0.
create function pg_temp.axis(p_index integer) returns real[]
language sql as $$
  select array_agg(case when i = p_index then 1::real else 0::real end order by i) from generate_series(1, 768) as i
$$;
grant execute on function pg_temp.axis(integer) to service_role;

create function pg_temp.case_of(p_ticket uuid) returns uuid
language sql as $$ select case_id from public.case_reports where complaint_id = p_ticket $$;
grant execute on function pg_temp.case_of(uuid) to authenticated, service_role;

-- Claims the next queued job (of any type) for this test as the worker would.
create function pg_temp.claim() returns table (job_id uuid, msg_id bigint, attempt smallint)
language sql as $$ select c.job_id, c.msg_id, c.attempt from public.worker_claim_ai_jobs(1, 30) as c $$;
grant execute on function pg_temp.claim() to service_role;

insert into public.departments (id, code, name) values ('db000000-0000-4000-8000-000000000001', 'dd_plumb', 'DD Plumbing');
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('ab000000-0000-4000-8000-00000000000a', 'dd.one@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('bb000000-0000-4000-8000-00000000000b', 'dd.two@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('cb000000-0000-4000-8000-00000000000c', 'dd.plumb@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('eb000000-0000-4000-8000-00000000000e', 'dd.admin@makeitright.test', 'authenticated', 'authenticated', '{}');
update public.profiles set role = 'department', department_id = 'db000000-0000-4000-8000-000000000001'
 where id = 'cb000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'eb000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid);
grant all on t to authenticated, service_role;

select pg_temp.act_as('ab000000-0000-4000-8000-00000000000a');
insert into t select 'a', r.id from public.create_ticket('Leak one', 'Water under the sink here.', 'Dup Hall', 'R1', gen_random_uuid()) as r;
insert into t select 'far', r.id from public.create_ticket('Leak far', 'Water under the sink there.', 'Other Hall', 'R1', gen_random_uuid()) as r;
select pg_temp.act_as('bb000000-0000-4000-8000-00000000000b');
insert into t select 'b', r.id from public.create_ticket('Leak two', 'The sink is leaking water.', 'dup hall ', 'r1', gen_random_uuid()) as r;
reset role;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants
            where table_name = 'complaint_embeddings' and grantee in ('anon', 'authenticated')), 0,
  'no API role has any privilege on complaint embeddings');
select ok(
  not has_function_privilege('authenticated', 'public.worker_save_embedding(uuid, bigint, smallint, text, text, real[])', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_duplicate_features(uuid, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_save_match_candidates(uuid, bigint, smallint, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_embedding_context(uuid)', 'execute'),
  'signed-in users cannot run the duplicate worker functions'
);

-- ---------------------------------------------------------------------------------------------
-- Queuing and embedding (F2.01-F2.02)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('bb000000-0000-4000-8000-00000000000b');
select throws_ok(format($$ select public.request_duplicate_check(%L) $$, (select id from t where name = 'a')),
  'MR404', null, 'a student cannot queue a check for someone else''s report');
reset role;

select pgmq.purge_queue('makeitright_ai_jobs');
select pg_temp.act_as('ab000000-0000-4000-8000-00000000000a');
insert into t select 'job_a', public.request_duplicate_check((select id from t where name = 'a'));
select is(public.request_duplicate_check((select id from t where name = 'a')), (select id from t where name = 'job_a'),
  'queuing the same report again returns the same job');
reset role;

select pg_temp.act_as_service();
create temp table claim_a as select * from pg_temp.claim();
select throws_ok(
  format($$ select public.worker_save_embedding(%L, %s, 1::smallint, 'gemini-embedding-2', repeat('a', 64), array[1, 0, 0]::real[]) $$,
         (select job_id from claim_a), (select msg_id from claim_a)),
  '22023', null, 'a vector that is not 768-dimensional is refused');
select throws_ok(
  format($$ select public.worker_save_embedding(%L, %s, 1::smallint, 'gemini-embedding-2', repeat('a', 64), null) $$,
         (select job_id from claim_a), (select msg_id from claim_a)),
  '22023', null, 'reusing a vector that does not exist is refused');
insert into t select 'match_a', public.worker_save_embedding(
  (select job_id from claim_a), (select msg_id from claim_a), 1::smallint, 'gemini-embedding-2', repeat('a', 64), pg_temp.axis(1));
select is((select job_type::text from public.ai_jobs where id = (select id from t where name = 'match_a')), 'duplicate_match',
  'storing a vector queues the report''s duplicate match in the same transaction');
select is(
  public.worker_save_embedding((select job_id from claim_a), (select msg_id from claim_a), 1::smallint,
    'gemini-embedding-2', repeat('a', 64), null),
  (select id from t where name = 'match_a'),
  'an unchanged text and model reuses the stored vector and the same match job');
reset role;
select is((select dimension || ' ' || model from public.complaint_embeddings where complaint_id = (select id from t where name = 'a')),
  '768 gemini-embedding-2', 'the vector records its model and dimension');

-- Vectors for the other reports, as the worker would store them.
insert into public.complaint_embeddings (complaint_id, model, embedding, text_hash)
select (select id from t where name = 'b'), 'gemini-embedding-2', pg_temp.axis(1)::extensions.vector, repeat('b', 64);
insert into public.complaint_embeddings (complaint_id, model, embedding, text_hash)
select (select id from t where name = 'far'), 'gemini-embedding-2', pg_temp.axis(1)::extensions.vector, repeat('c', 64);

-- ---------------------------------------------------------------------------------------------
-- Candidate features (F2.03)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table f as select * from public.worker_duplicate_features((select id from t where name = 'b'), 'gemini-embedding-2', 10);
reset role;
select is((select count(*)::int from f), 1, 'only a case in the same building is a candidate');
select is((select case_id from f), pg_temp.case_of((select id from t where name = 'a')), 'the candidate is the first report''s case');
select is((select round(similarity::numeric, 3) from f), 1.000::numeric, 'identical vectors have similarity 1');
select ok((select same_room from f), 'the same room is recognised despite case and spacing');

update public.complaint_embeddings set model = 'other-model' where complaint_id = (select id from t where name = 'a');
select pg_temp.act_as_service();
select is((select count(*)::int from public.worker_duplicate_features((select id from t where name = 'b'), 'gemini-embedding-2', 10)), 0,
  'vectors of a different model are never compared');
reset role;
update public.complaint_embeddings set model = 'gemini-embedding-2' where complaint_id = (select id from t where name = 'a');

-- ---------------------------------------------------------------------------------------------
-- Storing candidates
-- ---------------------------------------------------------------------------------------------
select pgmq.purge_queue('makeitright_ai_jobs');
insert into t select 'match_b', private.enqueue_ai_job('duplicate_match', (select id from t where name = 'b'), 'pgtap-dd-match-b');
select pg_temp.act_as_service();
create temp table claim_b as select * from pg_temp.claim();
select throws_ok(
  format($$ select public.worker_save_match_candidates(%L, %s, 1::smallint, 'gemini-embedding-2', %L::jsonb) $$,
         (select job_id from claim_b), (select msg_id from claim_b),
         (select jsonb_agg(jsonb_build_object('case_id', gen_random_uuid())) from generate_series(1, 6))),
  '22023', null, 'at most five candidates are stored');
select is(
  public.worker_save_match_candidates((select job_id from claim_b), (select msg_id from claim_b), 1::smallint, 'gemini-embedding-2',
    jsonb_build_array(
      jsonb_build_object('case_id', pg_temp.case_of((select id from t where name = 'a')), 'similarity', 0.97, 'score', 0.88,
        'same_building', true, 'same_room', true, 'category_match', false, 'same_asset', false),
      jsonb_build_object('case_id', pg_temp.case_of((select id from t where name = 'b')), 'similarity', 1, 'score', 1,
        'same_building', true, 'same_room', true, 'category_match', false, 'same_asset', false))),
  1, 'the report''s own case is never stored as its candidate');
reset role;
insert into t select 'cand', id from public.match_candidates where complaint_id = (select id from t where name = 'b');

-- ---------------------------------------------------------------------------------------------
-- Who sees candidates
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('bb000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.match_candidates), 0, 'the reporter does not see candidates for their report');
select pg_temp.act_as('cb000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.match_candidates), 0, 'a department sees no candidates for reports that are not theirs');
select pg_temp.act_as('eb000000-0000-4000-8000-00000000000e');
select is((select count(*)::int from public.match_candidates where id = (select id from t where name = 'cand')), 1,
  'an admin sees the candidate');

-- ---------------------------------------------------------------------------------------------
-- Deciding (F2.04-F2.05)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('cb000000-0000-4000-8000-00000000000c');
select throws_ok(
  format($$ select * from public.review_match_candidate(%L, 'accepted', 1) $$, (select id from t where name = 'cand')),
  'MR403', null, 'department staff cannot link reports');
select pg_temp.act_as('eb000000-0000-4000-8000-00000000000e');
select throws_ok(
  format($$ select * from public.review_match_candidate(%L, 'pending', 1) $$, (select id from t where name = 'cand')),
  '22023', null, 'a decision is accepted or rejected');
reset role;
update public.maintenance_cases set status = 'closed', closed_at = now() where id = pg_temp.case_of((select id from t where name = 'a'));
select pg_temp.act_as('eb000000-0000-4000-8000-00000000000e');
select throws_ok(
  format($$ select * from public.review_match_candidate(%L, 'accepted', %s) $$, (select id from t where name = 'cand'),
         (select version from public.maintenance_cases where id = pg_temp.case_of((select id from t where name = 'a')))),
  'MR422', null, 'a report cannot be linked into a closed case');
reset role;
update public.maintenance_cases set status = 'open', closed_at = null where id = pg_temp.case_of((select id from t where name = 'a'));

select pg_temp.act_as('eb000000-0000-4000-8000-00000000000e');
select lives_ok(
  format($$ select * from public.review_match_candidate(%L, 'accepted', %s) $$, (select id from t where name = 'cand'),
         (select version from public.maintenance_cases where id = pg_temp.case_of((select id from t where name = 'a')))),
  'an admin links the report into the matching case');
reset role;

select is(pg_temp.case_of((select id from t where name = 'b')), pg_temp.case_of((select id from t where name = 'a')),
  'both reports now belong to one case');
select is((select count(*)::int from public.complaints where id in ((select id from t where name = 'a'), (select id from t where name = 'b'))), 2,
  'both complaint rows still exist');
select is(
  (select array_agg(event_type::text order by id) from public.case_events
    where case_id = pg_temp.case_of((select id from t where name = 'a')) and event_type in ('report_linked', 'merged')),
  array['report_linked'], 'the shared case records the link');
select is(
  (select count(*)::int from public.maintenance_cases where status = 'merged'
     and merged_into_case_id = pg_temp.case_of((select id from t where name = 'a'))),
  1, 'the linked report''s old case is kept, marked merged');
select is((select decision::text from public.match_candidates where id = (select id from t where name = 'cand')), 'accepted',
  'the candidate is recorded as accepted');

-- A report that already shares a case cannot be linked again.
insert into public.match_candidates (complaint_id, candidate_case_id, model, similarity, score, same_building, same_room, category_match, same_asset)
select (select id from t where name = 'b'), pg_temp.case_of((select id from t where name = 'far')), 'gemini-embedding-2', 0.9, 0.7, false, false, false, false;
select pg_temp.act_as('eb000000-0000-4000-8000-00000000000e');
select throws_ok(
  format($$ select * from public.review_match_candidate(%L, 'accepted', %s) $$,
         (select id from public.match_candidates where complaint_id = (select id from t where name = 'b') and decision = 'pending'),
         (select version from public.maintenance_cases where id = pg_temp.case_of((select id from t where name = 'far')))),
  'MR422', null, 'a report that already shares a case cannot be moved again');
select is(public.dismiss_match_candidates((select id from t where name = 'b')), 1,
  '"keep as a separate case" rejects the remaining candidates');
reset role;

select * from finish();
rollback;
