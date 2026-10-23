-- Department workflow and audit (master plan P3.01-P3.03, P3.08, P3.09; BR-02-BR-07).
-- One ticket is walked through its whole life; every refusal on the way is asserted too.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Current version of the ticket under test, read as the owner (bypasses RLS).
create function pg_temp.v() returns integer
language sql as $$ select version from public.complaints where title = 'Workflow ticket' $$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into public.departments (id, code, name, is_active) values
  ('d3000000-0000-4000-8000-000000000001', 'wf_elec', 'WF Electrical', true),
  ('d3000000-0000-4000-8000-000000000002', 'wf_plumb', 'WF Plumbing', true),
  ('d3000000-0000-4000-8000-000000000003', 'wf_closed', 'WF Closed Dept', false);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a3000000-0000-4000-8000-00000000000a', 'wf.owner@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"WF Owner"}'),
  ('b3000000-0000-4000-8000-00000000000b', 'wf.other@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"WF Other"}'),
  ('c3000000-0000-4000-8000-00000000000c', 'wf.elec@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"WF Elec"}'),
  ('c3100000-0000-4000-8000-00000000000c', 'wf.plumb@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"WF Plumb"}'),
  ('e3000000-0000-4000-8000-00000000000e', 'wf.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"WF Admin"}');

update public.profiles set role = 'department', department_id = 'd3000000-0000-4000-8000-000000000001'
 where id = 'c3000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = 'd3000000-0000-4000-8000-000000000002'
 where id = 'c3100000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'e3000000-0000-4000-8000-00000000000e';

create temp table t (id uuid);
grant all on t to authenticated;

select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
insert into t select r.id from public.create_ticket('Workflow ticket', 'A ticket walked through every workflow step.',
                                                    'Block W', '1', gen_random_uuid()) as r;
reset role;

-- ---------------------------------------------------------------------------------------------
-- The transition table (P3.01)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select from_state::text, to_state::text, actor_role::text from public.ticket_transition_rules() $$,
  $$ values
       ('resolved', 'reopened', 'student'), ('resolved', 'closed', 'student'),
       ('assigned', 'in_progress', 'department'), ('in_progress', 'resolved', 'department'),
       ('reopened', 'in_progress', 'department'),
       ('assigned', 'in_progress', 'admin'), ('in_progress', 'resolved', 'admin'), ('resolved', 'reopened', 'admin'),
       ('resolved', 'closed', 'admin'), ('reopened', 'in_progress', 'admin') $$,
  'the transition table holds exactly the ten legal (from, to, role) changes'
);

select is(
  (select count(*)::int from private.ticket_transitions where from_state = 'closed'),
  0,
  'closed is terminal: no transition leaves it'
);

-- ---------------------------------------------------------------------------------------------
-- Assignment is admin-only and validated (P3.03, P3.07)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 1) $$,
  'MR403', null, 'a student cannot assign their own ticket'
);
reset role;

select pg_temp.act_as('c3000000-0000-4000-8000-00000000000c');
select throws_ok(
  $$ select * from public.acknowledge_ticket((select id from t), 1) $$,
  'MR404', null, 'department staff cannot act on a ticket not assigned to them (reported as missing)'
);
reset role;

select pg_temp.act_as('e3000000-0000-4000-8000-00000000000e');
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'unclassified', 'high', 1) $$,
  '22023', null, 'an assignment must classify the ticket'
);
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'unassessed', 1) $$,
  '22023', null, 'an assignment must assess priority'
);
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000003', 'electrical', 'high', 1) $$,
  '22023', null, 'inactive departments cannot receive tickets'
);
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 0) $$,
  'MR412', null, 'a stale version is refused (BR-07)'
);
select lives_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 1,
                                        'Routed manually while AI is disabled.') $$,
  'an admin assigns, classifies and prioritises the ticket'
);
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 2) $$,
  '22023', null, 'an assignment that changes nothing is refused'
);
reset role;

select results_eq(
  $$ select status::text, assigned_department_id, category::text, priority::text, version, acknowledged_at
       from public.complaints where id = (select id from t) $$,
  $$ values ('assigned', 'd3000000-0000-4000-8000-000000000001'::uuid, 'electrical', 'high', 2, null::timestamptz) $$,
  'the ticket is assigned, classified, prioritised and its version bumped'
);

select results_eq(
  $$ select actor_role::text, previous_status::text, new_status::text, department_id, category::text, priority::text, note
       from public.ticket_events where complaint_id = (select id from t) and event_type = 'assigned' $$,
  $$ values ('admin', 'submitted', 'assigned', 'd3000000-0000-4000-8000-000000000001'::uuid, 'electrical', 'high',
             'Routed manually while AI is disabled.') $$,
  'the assignment event records who, from what, to which department and classification'
);

-- ---------------------------------------------------------------------------------------------
-- Department work (P3.05): acknowledge, start, note, resolve
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('c3100000-0000-4000-8000-00000000000c');
select throws_ok(
  $$ select * from public.acknowledge_ticket((select id from t), 2) $$,
  'MR404', null, 'staff of another department cannot touch it (BR-02)'
);
reset role;

select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ select * from public.acknowledge_ticket((select id from t), 2) $$,
  'MR403', null, 'the reporter cannot acknowledge on behalf of the department'
);
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'in_progress', 2) $$,
  'MR403', null, 'the reporter cannot start work (the change exists, but not for students)'
);
reset role;

select pg_temp.act_as('c3000000-0000-4000-8000-00000000000c');
select lives_ok($$ select * from public.acknowledge_ticket((select id from t), 2) $$, 'assigned staff acknowledge it');
select throws_ok(
  $$ select * from public.acknowledge_ticket((select id from t), 3) $$,
  'MR422', null, 'a ticket is acknowledged once per assignment'
);
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'resolved', 3, 'Skipping the work step.') $$,
  'MR422', null, 'assigned → resolved skips a step and is not a legal change'
);
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'in_progress', 2) $$,
  'MR412', null, 'acting on a stale version is refused: no lost update (P3.08)'
);
select results_eq(
  $$ select status::text, version from public.transition_ticket((select id from t), 'in_progress', 3) $$,
  $$ values ('in_progress', 4) $$,
  'assigned staff start work'
);
select lives_ok(
  $$ select * from public.add_ticket_note((select id from t), 'Replaced the capacitor; testing tomorrow.') $$,
  'staff add a work note'
);
select throws_ok(
  $$ select * from public.add_ticket_note((select id from t), '   ') $$,
  '22023', null, 'an empty note is refused'
);
select throws_ok(
  $$ select * from public.add_ticket_note((select id from t), repeat('x', 1001)) $$,
  '22023', null, 'an over-long note is refused'
);
select is((select version from public.complaints where id = (select id from t)), 4,
          'a note does not change the ticket version');
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'resolved', 4) $$,
  '22023', null, 'resolving requires a note describing the fix'
);
select results_eq(
  $$ select status::text, version from public.transition_ticket((select id from t), 'resolved', 4, 'Fan replaced and tested.') $$,
  $$ values ('resolved', 5) $$,
  'assigned staff resolve it with a note'
);
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'closed', 5) $$,
  'MR403', null, 'staff cannot close a ticket for the reporter'
);
reset role;

select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ select * from public.add_ticket_note((select id from t), 'Student trying to add a work note.') $$,
  'MR403', null, 'the reporter cannot add work notes'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Reporter confirms or disputes (P3.06, BR-03)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('b3000000-0000-4000-8000-00000000000b');
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'closed', 5) $$,
  'MR404', null, 'another student cannot close someone else''s ticket'
);
reset role;

select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'reopened', 5) $$,
  '22023', null, 'reopening requires saying what is still wrong'
);
select results_eq(
  $$ select status::text, version from public.transition_ticket((select id from t), 'reopened', 5, 'Still making a clicking noise.') $$,
  $$ values ('reopened', 6) $$,
  'the reporter reopens a resolved ticket'
);
select is(
  (select count(*)::int from public.ticket_events where complaint_id = (select id from t)),
  7,
  'the reporter can read the whole timeline of their ticket, including staff notes'
);
reset role;

select pg_temp.act_as('c3000000-0000-4000-8000-00000000000c');
select results_eq(
  $$ select status::text, version from public.transition_ticket((select id from t), 'in_progress', 6) $$,
  $$ values ('in_progress', 7) $$,
  'staff take a reopened ticket back into work'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Reassignment moves the ticket between departments (P3.07)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('e3000000-0000-4000-8000-00000000000e');
select results_eq(
  $$ select status::text, version from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000002',
                                                             'plumbing', 'medium', 7, 'It is a leak, not a fan.') $$,
  $$ values ('assigned', 8) $$,
  'an admin reassigns an in-progress ticket to another department'
);
reset role;

select is(
  (select acknowledged_at from public.complaints where id = (select id from t)),
  null,
  'reassignment clears the previous acknowledgement'
);

select pg_temp.act_as('c3000000-0000-4000-8000-00000000000c');
select throws_ok(
  $$ select * from public.add_ticket_note((select id from t), 'Former department still trying.') $$,
  'MR404', null, 'the previous department loses access immediately'
);
select is((select count(*)::int from public.complaints where id = (select id from t)), 0,
          'and can no longer read it');
reset role;

select pg_temp.act_as('c3100000-0000-4000-8000-00000000000c');
select lives_ok($$ select * from public.transition_ticket((select id from t), 'in_progress', 8) $$,
                'the new department starts work');
select lives_ok($$ select * from public.transition_ticket((select id from t), 'resolved', 9, 'Pipe resealed.') $$,
                'and resolves it');
reset role;

select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select results_eq(
  $$ select status::text, version from public.transition_ticket((select id from t), 'closed', 10) $$,
  $$ values ('closed', 11) $$,
  'the reporter confirms the fix and closes the ticket'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Closed is final
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('e3000000-0000-4000-8000-00000000000e');
select throws_ok(
  $$ select * from public.transition_ticket((select id from t), 'reopened', 11, 'Admin trying to reopen.') $$,
  'MR422', null, 'a closed ticket cannot be reopened'
);
select throws_ok(
  $$ select * from public.assign_ticket((select id from t), 'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 11) $$,
  'MR422', null, 'a closed ticket cannot be reassigned'
);
select throws_ok(
  $$ select * from public.add_ticket_note((select id from t), 'Note on a closed ticket.') $$,
  'MR422', null, 'a closed ticket takes no more notes'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- The audit trail matches the database state (BR-04, P3.09)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select event_type::text, actor_role::text, coalesce(new_status::text, '-')
       from public.ticket_events where complaint_id = (select id from t) order by id $$,
  $$ values
       ('created', 'student', 'submitted'), ('assigned', 'admin', 'assigned'), ('acknowledged', 'department', 'assigned'),
       ('status_changed', 'department', 'in_progress'), ('note_added', 'department', 'in_progress'),
       ('status_changed', 'department', 'resolved'), ('status_changed', 'student', 'reopened'),
       ('status_changed', 'department', 'in_progress'), ('assigned', 'admin', 'assigned'),
       ('status_changed', 'department', 'in_progress'), ('status_changed', 'department', 'resolved'),
       ('status_changed', 'student', 'closed') $$,
  'the timeline records every step, by whom, in order'
);

select is(
  (select new_status from public.ticket_events where complaint_id = (select id from t) and new_status is not null
    order by id desc limit 1),
  (select status from public.complaints where id = (select id from t)),
  'the last event agrees with the ticket''s current status'
);

select is(pg_temp.v(), 11, 'every state-changing step bumped the version exactly once');

select pg_temp.act_as('c3100000-0000-4000-8000-00000000000c');
select throws_ok(
  $$ update public.complaints set status = 'in_progress' where id = (select id from t) $$,
  '42501', null, 'staff cannot bypass the workflow with a direct update'
);
reset role;

select throws_ok(
  $$ update public.ticket_events set note = 'rewritten' where complaint_id = (select id from t) $$,
  '42501', null, 'history stays append-only after the workflow changes'
);

-- ---------------------------------------------------------------------------------------------
-- Routing rules and queue ordering
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a3000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.routing_rules), 0, 'students cannot read routing rules');
reset role;

create temp table rr_total as select count(*)::int as n from public.routing_rules;
grant select on rr_total to authenticated;
select pg_temp.act_as('e3000000-0000-4000-8000-00000000000e');
select is((select count(*)::int from public.routing_rules), (select n from rr_total),
          'admins can read every routing rule');
reset role;

-- Three tickets with different priorities for the electrical queue.
select pg_temp.act_as('b3000000-0000-4000-8000-00000000000b');
insert into t select r.id from public.create_ticket('Queue low', 'Low priority ticket for ordering.', 'Queue Block', '', gen_random_uuid()) as r;
insert into t select r.id from public.create_ticket('Queue high', 'High priority ticket for ordering.', 'Queue Block', '', gen_random_uuid()) as r;
insert into t select r.id from public.create_ticket('Queue medium', 'Medium priority ticket for ordering.', 'Queue Block', '', gen_random_uuid()) as r;
reset role;

select pg_temp.act_as('e3000000-0000-4000-8000-00000000000e');
select * from public.assign_ticket((select c.id from public.complaints c where c.title = 'Queue low'),
                                   'd3000000-0000-4000-8000-000000000001', 'electrical', 'low', 1);
select * from public.assign_ticket((select c.id from public.complaints c where c.title = 'Queue high'),
                                   'd3000000-0000-4000-8000-000000000001', 'electrical', 'high', 1);
select * from public.assign_ticket((select c.id from public.complaints c where c.title = 'Queue medium'),
                                   'd3000000-0000-4000-8000-000000000001', 'electrical', 'medium', 1);
reset role;

select pg_temp.act_as('c3000000-0000-4000-8000-00000000000c');
select results_eq(
  $$ select title from public.list_complaints(10, null, null, null, 'priority') $$,
  $$ values ('Queue high'), ('Queue medium'), ('Queue low') $$,
  'the department queue sorts by priority, most urgent first, showing only its own tickets'
);
select throws_ok(
  $$ select * from public.list_complaints(10, null, null, null, 'random') $$,
  '22023', null, 'an unknown sort order is refused'
);
reset role;

select * from finish();
rollback;
