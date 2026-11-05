-- AI visual inspection results (Advanced Features plan v2 F1.03-F1.05, A2.01-A2.02): stored once
-- per photo and prompt version, only by the job's current attempt, readable with the ticket,
-- immutable, and answered by people in an append-only log.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

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

-- A valid stored result, as the worker's policy produces it.
create function pg_temp.result(p_overrides jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'visible_observations', jsonb_build_array('water pooling under the sink'),
    'possible_issue', 'possible plumbing leak',
    'suggested_category', 'plumbing',
    'severity_hint', 'medium',
    'not_visible_or_uncertain', jsonb_build_array('the pipe behind the cabinet'),
    'image_quality', 'usable',
    'text_consistency', 'consistent',
    'needs_human_review', false,
    'uncertainty_flags', jsonb_build_array('PARTLY_NOT_VISIBLE'),
    'explanation', 'Water is visible; its source is not.'
  ) || p_overrides
$$;
grant execute on function pg_temp.result(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Fixtures: a reporter's ticket with one finalised photo and its queued analysis job
-- ---------------------------------------------------------------------------------------------
insert into public.departments (id, code, name) values ('da000000-0000-4000-8000-000000000001', 'va_plumb', 'VA Plumbing');
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-00000000000a', 'va.owner@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ba000000-0000-4000-8000-00000000000b', 'va.other@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ca000000-0000-4000-8000-00000000000c', 'va.plumb@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ea000000-0000-4000-8000-00000000000e', 'va.admin@makeitright.test', 'authenticated', 'authenticated', '{}');
update public.profiles set role = 'department', department_id = 'da000000-0000-4000-8000-000000000001'
 where id = 'ca000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'ea000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid, msg bigint);
grant all on t to authenticated, service_role;

select pg_temp.act_as('aa000000-0000-4000-8000-00000000000a');
insert into t (name, id) select 'ticket', r.id
  from public.create_ticket('Visual ticket', 'A ticket whose photo is analysed.', 'Block V', '1', gen_random_uuid()) as r;
insert into t (name, id) select 'photo', r.attachment_id
  from public.request_evidence_upload((select id from t where name = 'ticket'), 'image/png', 100) as r;
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'complaint-evidence', a.object_path, split_part(a.object_path, '/', 1),
       jsonb_build_object('size', 100, 'mimetype', 'image/png')
  from public.evidence_attachments as a where a.id = (select id from t where name = 'photo');
select pg_temp.act_as('aa000000-0000-4000-8000-00000000000a');
insert into t (name, id) select 'job', r.job_id
  from public.finalize_evidence_upload((select id from t where name = 'photo'), repeat('b', 64), 100, 'image/png') as r;
reset role;

select pgmq.purge_queue('makeitright_ai_jobs');
update public.ai_jobs set queue_msg_id = (select pgmq.send('makeitright_ai_jobs', jsonb_build_object('job_id', id)))
 where id = (select id from t where name = 'job');

-- ---------------------------------------------------------------------------------------------
-- Worker functions (service role only)
-- ---------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.worker_visual_context(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_save_visual_analysis(uuid, bigint, smallint, text, text, jsonb)', 'execute'),
  'signed-in users, admins included, cannot read photo context or save analyses'
);

select pg_temp.act_as_service();
select is((select title from public.worker_visual_context((select id from t where name = 'photo'))), 'Visual ticket',
  'the worker reads the report text that goes with the photo');
select is((select object_path is not null from public.worker_visual_context((select id from t where name = 'photo'))), true,
  'and where the photo is stored');

update t set msg = (select msg_id from public.worker_claim_ai_jobs(1, 30)) where name = 'job';
select throws_ok(
  format($$ select public.worker_save_visual_analysis(%L, %s, 2::smallint, 'visual-v1', 'gemini-3.1-flash-lite', pg_temp.result()) $$,
         (select id from t where name = 'job'), (select msg from t where name = 'job')),
  'MR412', null, 'an attempt that does not hold the job cannot save a result'
);
insert into t (name, id)
select 'analysis', public.worker_save_visual_analysis(
  (select id from t where name = 'job'), (select msg from t where name = 'job'), 1::smallint,
  'visual-v1', 'gemini-3.1-flash-lite', pg_temp.result());
select is(
  public.worker_save_visual_analysis((select id from t where name = 'job'), (select msg from t where name = 'job'), 1::smallint,
    'visual-v1', 'gemini-3.1-flash-lite', pg_temp.result('{"suggested_category":"electrical"}')),
  (select id from t where name = 'analysis'),
  'saving again for the same photo and prompt version returns the first result'
);
reset role;

select is((select count(*)::int from public.visual_analyses where attachment_id = (select id from t where name = 'photo')), 1,
  'a retried job never stores a second analysis');
select is((select suggested_category::text from public.visual_analyses where id = (select id from t where name = 'analysis')),
  'plumbing', 'the first result stands');
select is((select prompt_version || ' ' || model from public.visual_analyses where id = (select id from t where name = 'analysis')),
  'visual-v1 gemini-3.1-flash-lite', 'the prompt version and model are recorded');
select is((select complaint_id from public.visual_analyses where id = (select id from t where name = 'analysis')),
  (select id from t where name = 'ticket'), 'the analysis belongs to the photo''s ticket');

-- Constraints the worker's policy must satisfy.
select pg_temp.act_as_service();
select throws_ok(
  $$ insert into public.visual_analyses (complaint_id, attachment_id, prompt_version, model, visible_observations, possible_issue,
       suggested_category, severity_hint, image_quality, text_consistency, needs_human_review, explanation)
     values ((select id from t where name = 'ticket'), (select id from t where name = 'photo'), 'visual-v9', 'm1',
       array['x'], 'y', 'plumbing', 'medium', 'usable', 'inconsistent', false, 'z') $$,
  '23514', null, 'even the service role cannot store an unsure analysis without review'
);
reset role;
select throws_ok(
  $$ insert into public.visual_analyses (complaint_id, attachment_id, prompt_version, model, visible_observations, possible_issue,
       suggested_category, severity_hint, image_quality, text_consistency, needs_human_review, explanation)
     values ((select id from t where name = 'ticket'), (select id from t where name = 'photo'), 'visual-v9', 'm1',
       array['x'], 'y', 'plumbing', 'medium', 'usable', 'inconsistent', false, 'z') $$,
  '23514', null, 'a photo that contradicts the report cannot be stored without review'
);
select throws_ok(
  $$ insert into public.visual_analyses (complaint_id, attachment_id, prompt_version, model, visible_observations, possible_issue,
       suggested_category, severity_hint, image_quality, text_consistency, needs_human_review, explanation)
     values ((select id from t where name = 'ticket'), (select id from t where name = 'photo'), 'visual-v9', 'm1',
       array['x'], 'y', 'plumbing', 'medium', 'blurry', 'consistent', false, 'z') $$,
  '23514', null, 'a blurry photo cannot be stored without review'
);
select throws_ok(
  $$ insert into public.visual_analyses (complaint_id, attachment_id, prompt_version, model, visible_observations, possible_issue,
       suggested_category, severity_hint, image_quality, text_consistency, needs_human_review, explanation)
     values ((select id from t where name = 'ticket'), (select id from t where name = 'photo'), 'visual-v9', 'm1',
       '{}', 'y', 'plumbing', 'medium', 'usable', 'consistent', true, 'z') $$,
  '23514', null, 'an analysis needs at least one visible observation'
);
select throws_ok(
  format($$ update public.visual_analyses set suggested_category = 'electrical' where id = %L $$, (select id from t where name = 'analysis')),
  '42501', 'visual_analyses is append-only', 'the model''s record cannot be changed, even by the table owner'
);

-- ---------------------------------------------------------------------------------------------
-- Reading: with the ticket
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('aa000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.visual_analyses), 1, 'the reporter sees the analysis of their photo');
select is((select job_status::text from public.photo_analysis_states((select id from t where name = 'ticket'))), 'running',
  'the reporter sees only the job''s state, through a narrow function');
select throws_ok(
  format($$ update public.visual_analyses set explanation = 'mine' where id = %L $$, (select id from t where name = 'analysis')),
  '42501', null, 'the reporter cannot rewrite the model''s record'
);

select pg_temp.act_as('ba000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.visual_analyses), 0, 'another student sees nothing');
select throws_ok(format($$ select * from public.photo_analysis_states(%L) $$, (select id from t where name = 'ticket')),
  'MR404', null, 'another student cannot read the photo states');

select pg_temp.act_as('ca000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.visual_analyses), 0, 'a department sees nothing before the ticket is theirs');
reset role;
update public.complaints set assigned_department_id = 'da000000-0000-4000-8000-000000000001', status = 'assigned'
 where id = (select id from t where name = 'ticket');
select pg_temp.act_as('ca000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.visual_analyses), 1, 'the assigned department sees the analysis');
select is((select count(*)::int from public.photo_analysis_states((select id from t where name = 'ticket'))), 1,
  'and the photo''s state');

select pg_temp.act_as('ea000000-0000-4000-8000-00000000000e');
select is((select count(*)::int from public.visual_analyses where id = (select id from t where name = 'analysis')), 1,
  'an admin sees the analysis');

-- ---------------------------------------------------------------------------------------------
-- Responses from people (append-only)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('aa000000-0000-4000-8000-00000000000a');
select lives_ok(format($$ select public.review_visual_analysis(%L, 'confirmed') $$, (select id from t where name = 'analysis')),
  'the reporter can confirm what the AI saw');
select throws_ok(format($$ select public.review_visual_analysis(%L, 'disputed') $$, (select id from t where name = 'analysis')),
  '22023', null, 'disputing needs a note saying what is wrong');
select lives_ok(format($$ select public.review_visual_analysis(%L, 'disputed', null, 'The leak is from the tap, not the pipe.') $$,
  (select id from t where name = 'analysis')), 'the reporter can dispute with a note');
select throws_ok(format($$ select public.review_visual_analysis(%L, 'corrected', 'electrical') $$, (select id from t where name = 'analysis')),
  'MR403', null, 'only an admin records a corrected category');

select pg_temp.act_as('ba000000-0000-4000-8000-00000000000b');
select throws_ok(format($$ select public.review_visual_analysis(%L, 'confirmed') $$, (select id from t where name = 'analysis')),
  'MR404', null, 'another student cannot respond');
select pg_temp.act_as('ca000000-0000-4000-8000-00000000000c');
select throws_ok(format($$ select public.review_visual_analysis(%L, 'confirmed') $$, (select id from t where name = 'analysis')),
  'MR404', null, 'department staff do not respond for the reporter');
select is((select count(*)::int from public.visual_analysis_reviews), 2, 'the assigned department can read the responses');

select pg_temp.act_as('ea000000-0000-4000-8000-00000000000e');
select lives_ok(format($$ select public.review_visual_analysis(%L, 'corrected', 'sanitation', 'Spilt cleaning water.') $$,
  (select id from t where name = 'analysis')), 'an admin can record a corrected category');
select throws_ok(
  format($$ insert into public.visual_analysis_reviews (analysis_id, reviewer_role, decision) values (%L, 'admin', 'confirmed') $$,
         (select id from t where name = 'analysis')),
  '42501', null, 'nobody inserts a response directly'
);
reset role;

select is(
  (select array_agg(decision::text || ':' || reviewer_role::text || ':' || coalesce(corrected_category::text, '-') order by id)
     from public.visual_analysis_reviews where analysis_id = (select id from t where name = 'analysis')),
  array['confirmed:student:-', 'disputed:student:-', 'corrected:admin:sanitation'],
  'every response is kept, in order'
);
select is((select suggested_category::text from public.visual_analyses where id = (select id from t where name = 'analysis')),
  'plumbing', 'responses never change the analysis');
select is((select category::text from public.complaints where id = (select id from t where name = 'ticket')),
  'unclassified', 'nor the ticket''s category');
select throws_ok(
  format($$ update public.visual_analysis_reviews set note = 'rewritten' where analysis_id = %L $$, (select id from t where name = 'analysis')),
  '42501', 'visual_analysis_reviews is append-only', 'responses are append-only'
);

select pg_temp.act_as('aa000000-0000-4000-8000-00000000000a');
select lives_ok(format($$ select public.review_visual_analysis(%L, 'confirmed') from generate_series(1, 8) $$,
  (select id from t where name = 'analysis')), 'a reporter can respond up to ten times');
select throws_ok(format($$ select public.review_visual_analysis(%L, 'confirmed') $$, (select id from t where name = 'analysis')),
  'MR429', null, 'but not an eleventh time');
reset role;

select * from finish();
rollback;
