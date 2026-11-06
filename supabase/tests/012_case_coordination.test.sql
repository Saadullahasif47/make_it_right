-- Maintenance coordinator (Advanced Features plan v2 F3.01-F3.05, A4.01-A4.04): one active work
-- order per case, kept in step with the case; proposals committed once, by policy or by an
-- administrator, against the case version the run started from.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

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

create function pg_temp.case_of(p_ticket uuid) returns uuid
language sql as $$ select case_id from public.case_reports where complaint_id = p_ticket $$;
grant execute on function pg_temp.case_of(uuid) to authenticated, service_role;

create function pg_temp.claim() returns table (job_id uuid, msg_id bigint, attempt smallint)
language sql as $$ select c.job_id, c.msg_id, c.attempt from public.worker_claim_ai_jobs(1, 30) as c $$;
grant execute on function pg_temp.claim() to service_role;

-- Finishes a claimed coordination job as the worker would, proposing furniture work.
create function pg_temp.finish(p_job uuid, p_msg bigint, p_version integer, p_department uuid,
                               p_priority text, p_reasons text[], p_auto boolean)
returns jsonb
language sql as $$
  select public.worker_finish_coordination(
    p_job, p_msg, 1::smallint, 'gemini-test', 'coordinator-v1', p_version,
    '[{"step":1,"tool":"propose_work_order","args":{},"verdict":"proposal","ms":3}]'::jsonb, 12, null,
    jsonb_build_object('department_id', p_department, 'category', 'furniture', 'priority', p_priority,
                       'rationale', 'A broken chair is furniture work.'),
    p_reasons, p_auto)
$$;
grant execute on function pg_temp.finish(uuid, bigint, integer, uuid, text, text[], boolean) to service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('ac000000-0000-4000-8000-00000000000a', 'co.student@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('cc000000-0000-4000-8000-00000000000c', 'co.furniture@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('dc000000-0000-4000-8000-00000000000d', 'co.plumbing@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ec000000-0000-4000-8000-00000000000e', 'co.admin@makeitright.test', 'authenticated', 'authenticated', '{}');
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'furniture')
 where id = 'cc000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'plumbing')
 where id = 'dc000000-0000-4000-8000-00000000000d';
update public.profiles set role = 'admin' where id = 'ec000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid);
grant all on t to authenticated, service_role;
insert into t select 'furniture', id from public.departments where code = 'furniture';
insert into t select 'plumbing', id from public.departments where code = 'plumbing';

select pg_temp.act_as('ac000000-0000-4000-8000-00000000000a');
insert into t select 'routine', r.id from public.create_ticket('Chair broken', 'The chair leg is cracked.', 'Co Hall', 'R1', gen_random_uuid()) as r;
insert into t select 'high', r.id from public.create_ticket('Desk collapsed', 'The desk top fell off.', 'Co Hall', 'R2', gen_random_uuid()) as r;
insert into t select 'manual', r.id from public.create_ticket('Door stuck', 'The door does not close.', 'Co Hall', 'R3', gen_random_uuid()) as r;
reset role;
insert into t select 'routine_case', pg_temp.case_of((select id from t where name = 'routine'));
insert into t select 'high_case', pg_temp.case_of((select id from t where name = 'high'));
insert into t select 'manual_case', pg_temp.case_of((select id from t where name = 'manual'));

-- ---------------------------------------------------------------------------------------------
-- Privileges (F3.02: no arbitrary writes, no worker functions for signed-in users)
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants
            where table_name in ('case_work_orders', 'coordination_runs', 'work_order_proposals')
              and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0,
  'API roles can only read work orders, runs and proposals');
select ok(
  not has_function_privilege('authenticated', 'public.worker_case_context(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_department_capacity(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_asset_history(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_related_cases(uuid, public.complaint_category, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_approved_routes()', 'execute')
  and not has_function_privilege('authenticated',
        'public.worker_finish_coordination(uuid, bigint, smallint, text, text, integer, jsonb, integer, text, jsonb, text[], boolean)', 'execute'),
  'signed-in users cannot run the coordinator worker functions'
);
select ok(not has_function_privilege('authenticated', 'private.commit_work_order(uuid, public.work_order_source, uuid, integer)', 'execute'),
  'nobody but the database commits a work order directly');
select ok(not has_function_privilege('anon', 'public.request_case_coordination(uuid)', 'execute'),
  'anonymous visitors cannot ask for coordination');

-- ---------------------------------------------------------------------------------------------
-- Work orders follow the case (A4.02)
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from public.case_work_orders where case_id = (select id from t where name = 'manual_case')), 0,
  'an unrouted case has no work order');
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select lives_ok(format($$ select public.assign_ticket(%L, %L, 'furniture', 'low', 1) $$,
  (select id from t where name = 'manual'), (select id from t where name = 'plumbing')),
  'an administrator routes a ticket by hand');
reset role;
select results_eq(
  format($$ select department_id, source::text, status::text from public.case_work_orders where case_id = %L $$,
         (select id from t where name = 'manual_case')),
  format($$ values (%L::uuid, 'ticket_routing', 'active') $$, (select id from t where name = 'plumbing')),
  'manual routing opens one active work order');

select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select lives_ok(format($$ select public.assign_ticket(%L, %L, 'furniture', 'low', %s) $$,
  (select id from t where name = 'manual'), (select id from t where name = 'furniture'),
  (select version from public.complaints where id = (select id from t where name = 'manual'))),
  'the administrator moves it to another department');
reset role;
select results_eq(
  format($$ select department_id, status::text from public.case_work_orders where case_id = %L order by assigned_at, status desc $$,
         (select id from t where name = 'manual_case')),
  format($$ values (%L::uuid, 'cancelled'), (%L::uuid, 'active') $$,
         (select id from t where name = 'plumbing'), (select id from t where name = 'furniture')),
  'a reassignment ends the old work order and starts one new one');
select throws_ok(
  format($$ insert into public.case_work_orders (case_id, department_id, source) values (%L, %L, 'ticket_routing') $$,
         (select id from t where name = 'manual_case'), (select id from t where name = 'plumbing')),
  '23505', null, 'a case can never have two active work orders');

-- ---------------------------------------------------------------------------------------------
-- Who may ask (plan §12) and the queued job (A4.01)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('ac000000-0000-4000-8000-00000000000a');
select throws_ok(format($$ select public.request_case_coordination(%L) $$, (select id from t where name = 'routine_case')),
  'MR403', null, 'a student cannot ask for coordination');
select pg_temp.act_as('dc000000-0000-4000-8000-00000000000d');
select throws_ok(format($$ select public.request_case_coordination(%L) $$, (select id from t where name = 'manual_case')),
  'MR404', null, 'a department cannot ask about a case it does not hold');
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select public.request_case_coordination(%L) $$,
  (select id from public.maintenance_cases where is_synthetic limit 1)),
  'MR404', null, 'synthetic history is never coordinated');
reset role;

select pgmq.purge_queue('makeitright_ai_jobs');
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
insert into t select 'job_routine', public.request_case_coordination((select id from t where name = 'routine_case'));
select is(public.request_case_coordination((select id from t where name = 'routine_case')), (select id from t where name = 'job_routine'),
  'asking again while the job waits returns the same job');
reset role;
select is((select target_version from public.ai_jobs where id = (select id from t where name = 'job_routine')),
  (select version from public.maintenance_cases where id = (select id from t where name = 'routine_case')),
  'the job carries the case version it was asked for');

-- ---------------------------------------------------------------------------------------------
-- Finishing a run (F3.03-F3.04)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table claim_routine as select * from pg_temp.claim();
grant all on claim_routine to service_role;
select is((select job_id from claim_routine), (select id from t where name = 'job_routine'), 'the worker claims the job');
select is(
  pg_temp.finish((select job_id from claim_routine), (select msg_id from claim_routine),
    (select version from public.maintenance_cases where id = (select id from t where name = 'routine_case')),
    (select id from t where name = 'furniture'), 'medium', '{}', true) ->> 'outcome',
  'committed', 'a routine proposal with no approval reasons commits');
select is(
  pg_temp.finish((select job_id from claim_routine), (select msg_id from claim_routine), 1,
    (select id from t where name = 'plumbing'), 'low', '{}', true) ->> 'outcome',
  'committed', 'finishing the same job again returns the first result');
reset role;
select is((select count(*)::int from public.coordination_runs where case_id = (select id from t where name = 'routine_case')), 1,
  'a retried job records one run');
select results_eq(
  format($$ select department_id, source::text from public.case_work_orders where case_id = %L and status = 'active' $$,
         (select id from t where name = 'routine_case')),
  format($$ values (%L::uuid, 'coordinator') $$, (select id from t where name = 'furniture')),
  'exactly one work order, from the coordinator');
select results_eq(
  format($$ select status::text, assigned_department_id from public.complaints where id = %L $$, (select id from t where name = 'routine')),
  format($$ values ('assigned', %L::uuid) $$, (select id from t where name = 'furniture')),
  'the report follows its case');
select throws_ok(
  format($$ update public.coordination_runs set outcome = 'superseded' where case_id = %L $$, (select id from t where name = 'routine_case')),
  '42501', null, 'runs are append-only');

-- High priority: the database adds the reason even if the worker forgot it.
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
insert into t select 'job_high', public.request_case_coordination((select id from t where name = 'high_case'));
reset role;
select pg_temp.act_as_service();
create temp table claim_high as select * from pg_temp.claim();
grant all on claim_high to service_role;
select is(
  pg_temp.finish((select job_id from claim_high), (select msg_id from claim_high),
    (select version from public.maintenance_cases where id = (select id from t where name = 'high_case')),
    (select id from t where name = 'furniture'), 'high', '{}', true) ->> 'outcome',
  'awaiting_approval', 'a high-priority proposal is never committed automatically');
reset role;
insert into t select 'proposal_high', id from public.work_order_proposals where case_id = (select id from t where name = 'high_case');
select is((select policy_reasons from public.work_order_proposals where id = (select id from t where name = 'proposal_high')),
  array['HIGH_PRIORITY'], 'the proposal says why it needs a person');
select is((select count(*)::int from public.case_work_orders where case_id = (select id from t where name = 'high_case')), 0,
  'no work order before approval');

-- ---------------------------------------------------------------------------------------------
-- Admin decisions (F3.04)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('cc000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.work_order_proposals), 0, 'departments cannot see proposals');
select is((select count(*)::int from public.coordination_runs), 0, 'departments cannot see runs');
select throws_ok(format($$ select public.admin_decide_proposal(%L, true, 1) $$, (select id from t where name = 'proposal_high')),
  'MR403', null, 'departments cannot decide proposals');
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select public.admin_decide_proposal(%L, true, %s) $$, (select id from t where name = 'proposal_high'),
  (select expected_case_version - 1 from public.work_order_proposals where id = (select id from t where name = 'proposal_high'))),
  'MR412', null, 'a page older than the case changes nothing');
select is(public.admin_decide_proposal((select id from t where name = 'proposal_high'), true,
  (select expected_case_version from public.work_order_proposals where id = (select id from t where name = 'proposal_high')),
  'Urgent: confirmed.'), 'committed', 'an administrator approves the proposal');
select throws_ok(format($$ select public.admin_decide_proposal(%L, false, 1) $$, (select id from t where name = 'proposal_high')),
  'MR422', null, 'a decided proposal cannot be decided again');
reset role;
select results_eq(
  format($$ select source::text, proposal_id from public.case_work_orders where case_id = %L and status = 'active' $$,
         (select id from t where name = 'high_case')),
  format($$ values ('admin_approved', %L::uuid) $$, (select id from t where name = 'proposal_high')),
  'the approved work order points at its proposal');
select is((select decided_by from public.work_order_proposals where id = (select id from t where name = 'proposal_high')),
  'ec000000-0000-4000-8000-00000000000e'::uuid, 'the decision records who made it');

-- A case that changed after the proposal: the proposal is retired, not committed.
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
insert into t select 'job_stale', public.request_case_coordination((select id from t where name = 'manual_case'));
reset role;
select pg_temp.act_as_service();
create temp table claim_stale as select * from pg_temp.claim();
grant all on claim_stale to service_role;
select is(
  pg_temp.finish((select job_id from claim_stale), (select msg_id from claim_stale),
    (select version from public.maintenance_cases where id = (select id from t where name = 'manual_case')),
    (select id from t where name = 'furniture'), 'medium', array['SHARED_CASE'], false) ->> 'outcome',
  'awaiting_approval', 'a proposal with a policy reason waits for a person');
reset role;
insert into t select 'proposal_stale', id from public.work_order_proposals
 where case_id = (select id from t where name = 'manual_case') and status = 'pending';
update public.maintenance_cases set version = version + 1 where id = (select id from t where name = 'manual_case');
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select is(public.admin_decide_proposal((select id from t where name = 'proposal_stale'), true,
  (select version from public.maintenance_cases where id = (select id from t where name = 'manual_case'))),
  'stale', 'approving after the case changed retires the proposal');
reset role;
select is((select status::text from public.work_order_proposals where id = (select id from t where name = 'proposal_stale')),
  'stale', 'the retirement is kept');

-- A run whose case changed while it waited, and a proposal outside the routing rules.
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
insert into t select 'job_super', public.request_case_coordination((select id from t where name = 'manual_case'));
reset role;
update public.maintenance_cases set version = version + 1 where id = (select id from t where name = 'manual_case');
select pg_temp.act_as_service();
create temp table claim_super as select * from pg_temp.claim();
grant all on claim_super to service_role;
select is(
  pg_temp.finish((select job_id from claim_super), (select msg_id from claim_super),
    (select version from public.maintenance_cases where id = (select id from t where name = 'manual_case')),
    (select id from t where name = 'furniture'), 'low', '{}', true) ->> 'outcome',
  'superseded', 'a case that changed after the request supersedes the run');
reset role;

select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
insert into t select 'job_route', public.request_case_coordination((select id from t where name = 'manual_case'));
reset role;
select pg_temp.act_as_service();
create temp table claim_route as select * from pg_temp.claim();
grant all on claim_route to service_role;
select is(
  pg_temp.finish((select job_id from claim_route), (select msg_id from claim_route),
    (select version from public.maintenance_cases where id = (select id from t where name = 'manual_case')),
    (select id from t where name = 'plumbing'), 'low', '{}', true) ->> 'outcome',
  'review_requested', 'a department outside the routing rules is refused by the database too');
reset role;
select is((select reason_code from public.coordination_runs where job_id = (select id from t where name = 'job_route')),
  'POLICY_REJECTED', 'the refusal is recorded');

-- The department now holding the case may ask too (its job is left queued).
select pg_temp.act_as('cc000000-0000-4000-8000-00000000000c');
select lives_ok(format($$ select public.request_case_coordination(%L) $$, (select id from t where name = 'manual_case')),
  'the department holding the case may ask');
reset role;

-- Each run is a paid model call: five per case a day.
insert into public.coordination_runs (case_id, model, prompt_version, outcome, case_version)
select (select id from t where name = 'manual_case'), 'gemini-test', 'coordinator-v1', 'review_requested', 1
  from generate_series(1, 5);
select pg_temp.act_as('ec000000-0000-4000-8000-00000000000e');
select throws_ok(format($$ select public.request_case_coordination(%L) $$, (select id from t where name = 'manual_case')),
  'MR429', null, 'a case gets at most five coordinator runs a day');
reset role;

-- Closing the case completes its work order.
update public.maintenance_cases set status = 'closed', closed_at = now() where id = (select id from t where name = 'routine_case');
select is((select status::text from public.case_work_orders where case_id = (select id from t where name = 'routine_case')),
  'completed', 'closing the case completes its work order');

select * from finish();
rollback;
