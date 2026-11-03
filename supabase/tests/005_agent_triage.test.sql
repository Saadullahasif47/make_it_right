-- Bounded AI triage (master plan P4.03-P4.08, P4.10; §8, §9, BR-08).
-- The privileged path is service_role only; every routing decision is re-checked here, and a
-- refused decision changes nothing at all.
begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- The server-only adapter's database role.
create function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into public.departments (id, code, name, is_active) values
  ('d5000000-0000-4000-8000-000000000001', 'ag_elec', 'AG Electrical', true),
  ('d5000000-0000-4000-8000-000000000002', 'ag_plumb', 'AG Plumbing', true),
  ('d5000000-0000-4000-8000-000000000003', 'ag_closed', 'AG Closed Dept', false);

-- Point three categories at the fixture departments for the length of this transaction.
update public.routing_rules set department_id = 'd5000000-0000-4000-8000-000000000001', enabled = true
 where category = 'electrical';
update public.routing_rules set department_id = 'd5000000-0000-4000-8000-000000000002', enabled = true
 where category = 'plumbing';
update public.routing_rules set department_id = 'd5000000-0000-4000-8000-000000000003', enabled = true
 where category = 'furniture';
update public.routing_rules set enabled = false where category = 'sanitation';

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a5000000-0000-4000-8000-00000000000a', 'ag.owner@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"AG Owner"}'),
  ('b5000000-0000-4000-8000-00000000000b', 'ag.other@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"AG Other"}'),
  ('e5000000-0000-4000-8000-00000000000e', 'ag.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"AG Admin"}');
update public.profiles set role = 'admin' where id = 'e5000000-0000-4000-8000-00000000000e';

create temp table tickets (name text primary key, id uuid);
create temp table runs (name text primary key, id uuid, version integer);
grant all on tickets, runs to authenticated, service_role;

select pg_temp.act_as('a5000000-0000-4000-8000-00000000000a');
insert into tickets
select name, (public.create_ticket(name || ' ticket', 'A fictional report used by the agent tests.',
                                   'Block A', '1', gen_random_uuid())).id
  from unnest(array['route', 'review', 'race', 'stale', 'rate']) as name;
reset role;

-- ---------------------------------------------------------------------------------------------
-- Only the privileged adapter can reach the agent functions (plan §9)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a5000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'submission',
                                          'a5000000-0000-4000-8000-00000000000a', 'm', 'v1') $$,
  '42501', null, 'a student cannot call the agent begin function'
);
reset role;
select pg_temp.act_as('e5000000-0000-4000-8000-00000000000e');
select throws_ok(
  $$ select * from public.agent_finish_run(gen_random_uuid(), 1, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'reason', null, '[]', 1) $$,
  '42501', null, 'not even an admin session can call the agent finish function'
);
select throws_ok(
  $$ insert into public.agent_runs (complaint_id, trigger, model, prompt_version)
     values ((select id from tickets where name = 'route'), 'admin_retry', 'm', 'v1') $$,
  '42501', null, 'nobody signed in can write agent runs directly'
);
reset role;

select ok(
  has_function_privilege('service_role', 'public.agent_begin_run(uuid, public.agent_run_trigger, uuid, text, text)', 'execute')
  and has_function_privilege('service_role',
        'public.agent_finish_run(uuid, integer, public.agent_run_outcome, public.complaint_category, uuid, public.ticket_priority, text, text, jsonb, integer)',
        'execute'),
  'the service role can execute both agent functions'
);

-- ---------------------------------------------------------------------------------------------
-- Starting a run
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'submission',
                                          'b5000000-0000-4000-8000-00000000000b', 'm', 'v1') $$,
  'MR403', null, 'another student''s request cannot start triage on this ticket'
);
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'submission',
                                          gen_random_uuid(), 'm', 'v1') $$,
  'MR403', null, 'an unknown requester is refused'
);
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'admin_retry',
                                          'a5000000-0000-4000-8000-00000000000a', 'm', 'v1') $$,
  'MR403', null, 'a student cannot request an admin retry'
);
select throws_ok(
  $$ select * from public.agent_begin_run(gen_random_uuid(), 'submission',
                                          'a5000000-0000-4000-8000-00000000000a', 'm', 'v1') $$,
  'MR404', null, 'a missing ticket is reported as missing'
);

insert into runs
select 'route', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'route'), 'submission',
                              'a5000000-0000-4000-8000-00000000000a', 'gemini-test', 'triage-v1') as r;
reset role;

select results_eq(
  $$ select status::text, version from public.complaints where id = (select id from tickets where name = 'route') $$,
  $$ values ('triaging', 2) $$,
  'starting a run moves the ticket to triaging and bumps its version'
);
select results_eq(
  $$ select event_type::text, actor_kind::text, actor_id, previous_status::text, new_status::text
       from public.ticket_events where complaint_id = (select id from tickets where name = 'route')
      order by id desc limit 1 $$,
  $$ values ('triage_started', 'agent', null::uuid, 'submitted', 'triaging') $$,
  'the start is audited as an agent event'
);

select pg_temp.as_service();
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'submission',
                                          'a5000000-0000-4000-8000-00000000000a', 'm', 'v1') $$,
  'MR409', null, 'a replayed submission never reruns AI'
);
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'admin_retry',
                                          'e5000000-0000-4000-8000-00000000000e', 'm', 'v1') $$,
  'MR409', null, 'an admin retry cannot race a live attempt'
);

-- ---------------------------------------------------------------------------------------------
-- Every unsafe decision is refused and changes nothing (P4.05, P4.10)
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000002', 'low', 'Lights are out.', null, '[]', 10) $$,
  'MR422', null, 'a department that is not the approved route is refused'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           gen_random_uuid(), 'low', 'Lights are out.', null, '[]', 10) $$,
  'MR422', null, 'a fabricated department is refused'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'furniture',
                                           'd5000000-0000-4000-8000-000000000003', 'low', 'Chair is broken.', null, '[]', 10) $$,
  'MR422', null, 'a route to an inactive department is refused'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'sanitation',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Bins overflowing.', null, '[]', 10) $$,
  'MR422', null, 'a disabled routing rule approves nothing'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'high', 'Lights are out.', null, '[]', 10) $$,
  'MR422', null, 'high priority is never approved without review (BR-08)'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'unassessed', 'Lights are out.', null, '[]', 10) $$,
  'MR422', null, 'an unassessed priority cannot be routed'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'unclassified',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Lights are out.', null, '[]', 10) $$,
  'MR422', null, 'an unclassified ticket cannot be routed'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'ok', null, '[]', 10) $$,
  '22023', null, 'a routed decision needs a real reason'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Lights are out.', 'TIMEOUT', '[]', 10) $$,
  '22023', null, 'a routed decision cannot carry a failure code'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'superseded', null,
                                           null, null, null, 'X_CODE', '[]', 10) $$,
  '22023', null, 'the adapter can only report routed or needs_review'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Lights are out.', null, '{"a":1}', 10) $$,
  '22023', null, 'the tool trace must be an array'
);
reset role;

select results_eq(
  $$ select status::text, version, category::text, priority::text, assigned_department_id
       from public.complaints where id = (select id from tickets where name = 'route') $$,
  $$ values ('triaging', 2, 'unclassified', 'unassessed', null::uuid) $$,
  'after eleven refused decisions the ticket is exactly as it was'
);
select results_eq(
  $$ select (select count(*)::int from public.ticket_events where complaint_id = (select id from tickets where name = 'route')),
            (select outcome::text from public.agent_runs where id = (select id from runs where name = 'route')) $$,
  $$ values (2, 'running') $$,
  'refused decisions append no events and leave the run open'
);

-- ---------------------------------------------------------------------------------------------
-- An approved decision routes the ticket atomically
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
select results_eq(
  $$ select outcome::text, status::text, version
       from public.agent_finish_run((select id from runs where name = 'route'), 2, 'routed', 'electrical',
                                    'd5000000-0000-4000-8000-000000000001', 'medium',
                                    'Ceiling lights in the corridor are out.', null,
                                    '[{"step":1,"name":"propose_assignment","verdict":"accepted"}]', 812) $$,
  $$ values ('routed', 'assigned', 3) $$,
  'a decision that matches the routing policy is applied'
);
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'route'), 3, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Again please.', null, '[]', 10) $$,
  'MR409', null, 'a finished run cannot be finished again'
);
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'route'), 'admin_retry',
                                          'e5000000-0000-4000-8000-00000000000e', 'm', 'v1') $$,
  'MR422', null, 'a routed ticket is not awaiting routing, so it cannot be retried'
);
reset role;

select results_eq(
  $$ select status::text, category::text, priority::text, assigned_department_id, acknowledged_at
       from public.complaints where id = (select id from tickets where name = 'route') $$,
  $$ values ('assigned', 'electrical', 'medium', 'd5000000-0000-4000-8000-000000000001'::uuid, null::timestamptz) $$,
  'the ticket carries the approved category, priority and department'
);
select results_eq(
  $$ select event_type::text, actor_kind::text, actor_id, department_id, category::text, priority::text, note
       from public.ticket_events where complaint_id = (select id from tickets where name = 'route')
      order by id desc limit 1 $$,
  $$ values ('assigned', 'agent', null::uuid, 'd5000000-0000-4000-8000-000000000001'::uuid,
             'electrical', 'medium', 'Ceiling lights in the corridor are out.') $$,
  'the assignment is audited as the agent''s, with its short reason'
);
select results_eq(
  $$ select outcome::text, failure_code, model, prompt_version, duration_ms, finished_at is not null,
            tool_calls -> 0 ->> 'verdict'
       from public.agent_runs where id = (select id from runs where name = 'route') $$,
  $$ values ('routed', null::text, 'gemini-test', 'triage-v1', 812, true, 'accepted') $$,
  'the run records model, prompt version, duration and the tool trace'
);

-- ---------------------------------------------------------------------------------------------
-- Handing a ticket to a human (P4.08)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
insert into runs
select 'review', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'review'), 'submission',
                              'a5000000-0000-4000-8000-00000000000a', 'gemini-test', 'triage-v1') as r;
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'review'), 2, 'needs_review', null,
                                           null, null, null, null, '[]', 10) $$,
  '22023', null, 'a review needs a stable failure code'
);
select results_eq(
  $$ select outcome::text, status::text, version
       from public.agent_finish_run((select id from runs where name = 'review'), 2, 'needs_review', 'plumbing',
                                    gen_random_uuid(), 'high', null, 'RATE_LIMITED', '[]', 9000) $$,
  $$ values ('needs_review', 'needs_review', 3) $$,
  'a failed attempt leaves the ticket stored and waiting for review'
);
reset role;

select results_eq(
  $$ select r.failure_code, r.proposed_category::text, r.proposed_department_id, r.proposed_priority::text,
            c.category::text, c.assigned_department_id
       from public.agent_runs as r join public.complaints as c on c.id = r.complaint_id
      where r.id = (select id from runs where name = 'review') $$,
  $$ values ('RATE_LIMITED', 'plumbing', null::uuid, 'high', 'unclassified', null::uuid) $$,
  'the suggestion is kept for the admin, a fabricated department is dropped, the ticket is untouched'
);
select is(
  (select event_type::text from public.ticket_events
    where complaint_id = (select id from tickets where name = 'review') order by id desc limit 1),
  'review_requested',
  'the hand-off is on the timeline'
);

-- ---------------------------------------------------------------------------------------------
-- Someone acts while the model is thinking: the agent never overwrites them
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
insert into runs
select 'race', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'race'), 'submission',
                              'a5000000-0000-4000-8000-00000000000a', 'gemini-test', 'triage-v1') as r;
reset role;
select pg_temp.act_as('e5000000-0000-4000-8000-00000000000e');
select * from public.assign_ticket((select id from tickets where name = 'race'),
                                   'd5000000-0000-4000-8000-000000000002', 'plumbing', 'high', 2);
reset role;

select pg_temp.as_service();
select results_eq(
  $$ select outcome::text, status::text, version
       from public.agent_finish_run((select id from runs where name = 'race'), 2, 'routed', 'electrical',
                                    'd5000000-0000-4000-8000-000000000001', 'low', 'Lights are out.', null, '[]', 10) $$,
  $$ values ('superseded', 'assigned', 3) $$,
  'a run that finishes after an admin acted is recorded as superseded'
);
reset role;
select results_eq(
  $$ select c.assigned_department_id, c.category::text, r.failure_code
       from public.complaints as c join public.agent_runs as r on r.complaint_id = c.id
      where c.id = (select id from tickets where name = 'race') $$,
  $$ values ('d5000000-0000-4000-8000-000000000002'::uuid, 'plumbing', 'TICKET_CHANGED') $$,
  'the admin''s routing stands'
);

-- ---------------------------------------------------------------------------------------------
-- Bounded admin retries and recovery of stuck attempts (P4.08)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
insert into runs
select 'retry1', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'review'), 'admin_retry',
                              'e5000000-0000-4000-8000-00000000000e', 'gemini-test', 'triage-v1') as r;
reset role;
select is(
  (select previous_status::text || '>' || new_status::text from public.ticket_events
    where complaint_id = (select id from tickets where name = 'review') order by id desc limit 1),
  'needs_review>triaging',
  'an admin can retry a ticket that is waiting for review'
);

select pg_temp.as_service();
select * from public.agent_finish_run((select id from runs where name = 'retry1'), 4, 'needs_review', null,
                                      null, null, null, 'TIMEOUT', '[]', 8000);
insert into runs
select 'retry2', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'review'), 'admin_retry',
                              'e5000000-0000-4000-8000-00000000000e', 'gemini-test', 'triage-v1') as r;
select * from public.agent_finish_run((select id from runs where name = 'retry2'), 6, 'needs_review', null,
                                      null, null, null, 'TIMEOUT', '[]', 8000);
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'review'), 'admin_retry',
                                          'e5000000-0000-4000-8000-00000000000e', 'm', 'v1') $$,
  'MR429', null, 'a ticket gets at most three AI attempts'
);

insert into runs
select 'stale', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'stale'), 'submission',
                              'a5000000-0000-4000-8000-00000000000a', 'gemini-test', 'triage-v1') as r;
reset role;
-- Simulate a function that stopped three minutes ago after committing the start.
update public.agent_runs set started_at = now() - interval '3 minutes' where id = (select id from runs where name = 'stale');

select pg_temp.as_service();
insert into runs
select 'takeover', r.run_id, r.ticket_version
  from public.agent_begin_run((select id from tickets where name = 'stale'), 'admin_retry',
                              'e5000000-0000-4000-8000-00000000000e', 'gemini-test', 'triage-v1') as r;
select throws_ok(
  $$ select * from public.agent_finish_run((select id from runs where name = 'stale'), 2, 'routed', 'electrical',
                                           'd5000000-0000-4000-8000-000000000001', 'low', 'Lights are out.', null, '[]', 10) $$,
  'MR409', null, 'the stuck attempt cannot finish after it was taken over'
);
reset role;
select results_eq(
  $$ select outcome::text, coalesce(failure_code, '-') from public.agent_runs
      where complaint_id = (select id from tickets where name = 'stale') order by started_at $$,
  $$ values ('superseded', 'ABANDONED'), ('running', '-') $$,
  'a retry takes over a stuck attempt and marks it abandoned'
);
select is(
  (select version from runs where name = 'takeover'),
  3,
  'the takeover bumps the version so the stuck attempt''s decision would be stale too'
);

-- Per-admin retry budget: ten retries in ten minutes, durable in the database.
insert into public.agent_runs (complaint_id, trigger, requested_by, model, prompt_version, outcome, failure_code, finished_at)
select (select id from tickets where name = 'race'), 'admin_retry', 'e5000000-0000-4000-8000-00000000000e',
       'gemini-test', 'triage-v1', 'needs_review', 'TIMEOUT', now()
  from generate_series(1, 7);
select pg_temp.as_service();
select throws_ok(
  $$ select * from public.agent_begin_run((select id from tickets where name = 'rate'), 'admin_retry',
                                          'e5000000-0000-4000-8000-00000000000e', 'm', 'v1') $$,
  'MR429', null, 'an admin gets at most ten AI retries in ten minutes'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Run records are admin-only and read-only (plan §10)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a5000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.agent_runs), 0, 'a student cannot read agent runs, even for their own tickets');
reset role;
select pg_temp.act_as('e5000000-0000-4000-8000-00000000000e');
select ok((select count(*) from public.agent_runs) >= 13, 'an admin can read agent runs');
select throws_ok(
  $$ update public.agent_runs set failure_code = 'EDITED' $$,
  '42501', null, 'an admin cannot edit run records'
);
select throws_ok(
  $$ delete from public.agent_runs $$,
  '42501', null, 'an admin cannot delete run records'
);
reset role;

select is(
  (select count(*)::int from public.agent_runs where outcome = 'running'),
  1,
  'exactly one attempt is still in flight (the takeover), and the unique index allows no more'
);
select throws_ok(
  $$ insert into public.agent_runs (complaint_id, trigger, model, prompt_version)
     values ((select id from tickets where name = 'stale'), 'admin_retry', 'm', 'v1') $$,
  '23505', null, 'a second concurrent attempt on one ticket is impossible'
);

select * from finish();
rollback;
