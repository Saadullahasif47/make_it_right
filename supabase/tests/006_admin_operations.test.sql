-- Administrator metrics and configuration (master plan P5.01, P5.06; Gate P5: admin sees accurate
-- aggregates). Metrics are checked as deltas against a snapshot taken before the fixtures, so
-- rows left by other local runs cannot make the test flaky.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Fixtures ------------------------------------------------------------------------------------
insert into public.departments (id, code, name, is_active) values
  ('d6000000-0000-4000-8000-000000000001', 'ops_a', 'OPS Alpha', true),
  ('d6000000-0000-4000-8000-000000000002', 'ops_b', 'OPS Beta', true),
  ('d6000000-0000-4000-8000-000000000003', 'ops_c', 'OPS Closed', false);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a6000000-0000-4000-8000-00000000000a', 'ops.student@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"OPS Student"}'),
  ('c6000000-0000-4000-8000-00000000000c', 'ops.staff@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"OPS Staff"}'),
  ('e6000000-0000-4000-8000-00000000000e', 'ops.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"OPS Admin"}');
update public.profiles set role = 'department', department_id = 'd6000000-0000-4000-8000-000000000001'
 where id = 'c6000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'e6000000-0000-4000-8000-00000000000e';

create temp table snap (name text primary key, m jsonb);
create temp table tickets (name text primary key, id uuid);
grant all on snap, tickets to authenticated;

-- Snapshot before any fixture ticket exists.
select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
insert into snap values ('before', public.admin_metrics(30));
reset role;

select pg_temp.act_as('a6000000-0000-4000-8000-00000000000a');
insert into tickets
select name, (public.create_ticket(name || ' ops ticket', 'A fictional report for the metrics tests.',
                                   'Block O', '1', gen_random_uuid())).id
  from unnest(array['waiting', 'assigned', 'resolved', 'stalled']) as name;
reset role;

-- Route two tickets to OPS Alpha; work and resolve one of them.
select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
select * from public.assign_ticket((select id from tickets where name = 'assigned'),
  'd6000000-0000-4000-8000-000000000001', 'electrical', 'medium', 1);
select * from public.assign_ticket((select id from tickets where name = 'resolved'),
  'd6000000-0000-4000-8000-000000000001', 'electrical', 'low', 1);
reset role;
select pg_temp.act_as('c6000000-0000-4000-8000-00000000000c');
select * from public.transition_ticket((select id from tickets where name = 'resolved'), 'in_progress', 2);
select * from public.transition_ticket((select id from tickets where name = 'resolved'), 'resolved', 3, 'Replaced the fuse.');
reset role;

-- An AI attempt that stopped long ago leaves its ticket in "triaging".
alter table public.complaints disable trigger complaints_touch_updated_at;
update public.complaints set status = 'triaging', updated_at = now() - interval '10 minutes'
 where id = (select id from tickets where name = 'stalled');
alter table public.complaints enable trigger complaints_touch_updated_at;

-- Two AI runs in the window.
insert into public.agent_runs (complaint_id, trigger, requested_by, model, prompt_version, outcome, failure_code, duration_ms, finished_at)
values
  ((select id from tickets where name = 'assigned'), 'submission', 'a6000000-0000-4000-8000-00000000000a', 'm', 'v1', 'routed', null, 1000, now()),
  ((select id from tickets where name = 'waiting'), 'submission', 'a6000000-0000-4000-8000-00000000000a', 'm', 'v1', 'needs_review', 'RATE_LIMITED', 3000, now());

select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
insert into snap values ('after', public.admin_metrics(30));
reset role;

create function pg_temp.delta(path text[]) returns integer
language sql as $$
  select (select (m #>> path)::integer from snap where name = 'after')
       - (select coalesce((m #>> path)::integer, 0) from snap where name = 'before')
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may read metrics
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a6000000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_metrics(30) $$, 'MR403', null, 'a student cannot read metrics');
reset role;
select pg_temp.act_as('c6000000-0000-4000-8000-00000000000c');
select throws_ok($$ select public.admin_metrics(30) $$, 'MR403', null, 'department staff cannot read metrics');
reset role;
select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
select throws_ok($$ select public.admin_metrics(0) $$, '22023', null, 'the window must be at least one day');
select throws_ok($$ select public.admin_metrics(91) $$, '22023', null, 'the window is capped at ninety days');
reset role;

-- ---------------------------------------------------------------------------------------------
-- The numbers are accurate (Gate P5)
-- ---------------------------------------------------------------------------------------------
select ok(
  (select m ?& array['generated_at', 'window_days', 'totals', 'status_counts', 'routing', 'aging',
                     'resolution', 'created_per_day', 'departments', 'ai'] from snap where name = 'after'),
  'metrics carry every section the dashboard needs'
);
select is((select (select count(*) from jsonb_object_keys(m -> 'status_counts'))::int from snap where name = 'after'),
          8, 'every lifecycle state is counted, zeros included');
select is(pg_temp.delta(array['totals', 'all']), 4, 'four new tickets are counted');
select is(pg_temp.delta(array['totals', 'open']), 3, 'three of them are still open');
select is(pg_temp.delta(array['totals', 'created_in_window']), 4, 'all four were created in the window');
select is(pg_temp.delta(array['status_counts', 'submitted']), 1, 'one ticket is still submitted');
select is(pg_temp.delta(array['status_counts', 'assigned']), 1, 'one ticket is assigned');
select is(pg_temp.delta(array['status_counts', 'resolved']), 1, 'one ticket is resolved');
select is(pg_temp.delta(array['status_counts', 'triaging']), 1, 'one ticket is triaging');
select is(pg_temp.delta(array['routing', 'awaiting']), 2, 'two tickets wait for routing');
select is(pg_temp.delta(array['routing', 'stalled_triage']), 1, 'the stuck AI attempt is reported as stalled');
select is(pg_temp.delta(array['aging', 'under_1_day']), 3, 'the open tickets are all under a day old');
select is(pg_temp.delta(array['resolution', 'resolved_in_window']), 1, 'one ticket was resolved in the window');
select ok((select (m #>> '{resolution,median_hours}') is not null from snap where name = 'after'),
          'a median resolution time is reported once something was resolved');

select results_eq(
  $$ select (r ->> 'open')::int, (r ->> 'unacknowledged')::int, (r ->> 'in_progress')::int,
            (r ->> 'resolved_in_window')::int, (r ->> 'is_active')::boolean
       from snap, jsonb_array_elements(m -> 'departments') as r
      where name = 'after' and r ->> 'name' = 'OPS Alpha' $$,
  $$ values (1, 1, 0, 1, true) $$,
  'the department row counts open, unacknowledged and resolved work exactly'
);
select results_eq(
  $$ select (r ->> 'open')::int, (r ->> 'is_active')::boolean
       from snap, jsonb_array_elements(m -> 'departments') as r
      where name = 'after' and r ->> 'name' = 'OPS Closed' $$,
  $$ values (0, false) $$,
  'inactive departments are listed too, marked inactive'
);
select results_eq(
  $$ select jsonb_array_length(m -> 'created_per_day'),
            (m -> 'created_per_day' -> 13 ->> 'day')::date = (now() at time zone 'utc')::date
       from snap where name = 'after' $$,
  $$ values (14, true) $$,
  'the daily series covers the last fourteen days, ending today'
);
select is(
  (select (a.m -> 'created_per_day' -> 13 ->> 'count')::int - (b.m -> 'created_per_day' -> 13 ->> 'count')::int
     from snap as a, snap as b where a.name = 'after' and b.name = 'before'),
  4, 'today''s bar counts the four new tickets'
);
select is(pg_temp.delta(array['ai', 'runs']), 2, 'AI runs in the window are counted');
select is(pg_temp.delta(array['ai', 'routed']), 1, 'routed runs are counted');
select is(pg_temp.delta(array['ai', 'needs_review']), 1, 'runs sent for review are counted');
select ok((select (m #>> '{ai,review_reasons,RATE_LIMITED}')::int >= 1 from snap where name = 'after'),
          'review reasons are broken down by stable code');

-- ---------------------------------------------------------------------------------------------
-- Department availability
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a6000000-0000-4000-8000-00000000000a');
select throws_ok($$ select * from public.admin_set_department_active('d6000000-0000-4000-8000-000000000002', false) $$,
                 'MR403', null, 'a student cannot change department availability');
reset role;

select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
select * from public.admin_set_routing_rule('plumbing', 'd6000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$ select is_active, routes_affected from public.admin_set_department_active('d6000000-0000-4000-8000-000000000002', false) $$,
  $$ values (false, 1) $$,
  'an admin can deactivate a department and is told how many routing rules it affects'
);
select throws_ok($$ select * from public.admin_set_department_active('d6000000-0000-4000-8000-000000000002', false) $$,
                 'MR304', null, 'a change that changes nothing is reported as not modified');
select throws_ok($$ select * from public.admin_set_department_active(gen_random_uuid(), true) $$,
                 'MR404', null, 'an unknown department is reported as missing');

-- ---------------------------------------------------------------------------------------------
-- Routing rules
-- ---------------------------------------------------------------------------------------------
select throws_ok($$ select * from public.admin_set_routing_rule('plumbing', 'd6000000-0000-4000-8000-000000000003', true) $$,
                 '22023', null, 'an enabled rule cannot point at an inactive department');
select throws_ok($$ select * from public.admin_set_routing_rule('unclassified', 'd6000000-0000-4000-8000-000000000001', true) $$,
                 '22023', null, 'unclassified cannot have a routing rule');
select results_eq(
  $$ select category::text, department_id, enabled
       from public.admin_set_routing_rule('electrical', 'd6000000-0000-4000-8000-000000000001', true) $$,
  $$ values ('electrical', 'd6000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'an admin can point a category at another department'
);
select throws_ok($$ select * from public.admin_set_routing_rule('electrical', 'd6000000-0000-4000-8000-000000000001', true) $$,
                 'MR304', null, 'setting the same rule again is reported as not modified');
reset role;

select is((select department_id from public.routing_rules where category = 'electrical'),
          'd6000000-0000-4000-8000-000000000001'::uuid, 'the rule is stored');

select pg_temp.act_as('c6000000-0000-4000-8000-00000000000c');
select throws_ok($$ select * from public.admin_set_routing_rule('electrical', 'd6000000-0000-4000-8000-000000000002', false) $$,
                 'MR403', null, 'department staff cannot change routing rules');
reset role;

-- ---------------------------------------------------------------------------------------------
-- The change log is admin-only and append-only
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select entity, entity_key, before_value -> 'department_id' is not null, after_value ->> 'enabled'
       from public.config_changes where changed_by = 'e6000000-0000-4000-8000-00000000000e'
      order by id desc limit 1 $$,
  $$ values ('routing_rule', 'electrical', true, 'true') $$,
  'every change is logged with its actor, before and after'
);
select is((select count(*)::int from public.config_changes where changed_by = 'e6000000-0000-4000-8000-00000000000e'),
          3, 'three changes were logged (rule, department, rule)');

select pg_temp.act_as('a6000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.config_changes), 0, 'students cannot read the change log');
reset role;
select pg_temp.act_as('e6000000-0000-4000-8000-00000000000e');
select ok((select count(*) from public.config_changes) >= 3, 'administrators can read the change log');
select throws_ok($$ update public.config_changes set entity_key = 'x' $$, '42501', null, 'admins cannot edit the change log');
select throws_ok($$ update public.routing_rules set enabled = false $$, '42501', null, 'routing rules change only through the audited function');
select throws_ok($$ update public.departments set is_active = false $$, '42501', null, 'departments change only through the audited function');
reset role;
select throws_ok($$ delete from public.config_changes $$, '42501', null, 'not even the owner can delete history');

select * from finish();
rollback;
