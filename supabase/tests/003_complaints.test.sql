-- Complaint persistence rules (master plan P2.01-P2.03, P2.07, P2.09; BR-01, BR-04, BR-08, BR-10).
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (fictional; rolled back at the end)
-- ---------------------------------------------------------------------------------------------
insert into public.departments (id, code, name) values
  ('d1000000-0000-4000-8000-000000000001', 'test_elec', 'Test Electrical'),
  ('d1000000-0000-4000-8000-000000000002', 'test_plumb', 'Test Plumbing');

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-00000000000a', 'p2.student.a@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Student A"}'),
  ('b1000000-0000-4000-8000-00000000000b', 'p2.student.b@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Student B"}'),
  ('c1000000-0000-4000-8000-00000000000c', 'p2.elec@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Elec"}'),
  ('c2000000-0000-4000-8000-00000000000c', 'p2.plumb@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Plumb"}'),
  ('e1000000-0000-4000-8000-00000000000e', 'p2.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Admin"}'),
  ('f1000000-0000-4000-8000-00000000000f', 'p2.busy@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"P2 Busy"}');

update public.profiles set role = 'department', department_id = 'd1000000-0000-4000-8000-000000000001'
 where id = 'c1000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = 'd1000000-0000-4000-8000-000000000002'
 where id = 'c2000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'e1000000-0000-4000-8000-00000000000e';

create temp table t_ids (label text primary key, id uuid, reference_no integer);
grant all on t_ids to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Creation (P2.03)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-00000000000a');

insert into t_ids
select 'first', r.id, r.reference_no
  from public.create_ticket('  Ceiling fan broken  ', 'The ceiling fan in room 214 stopped spinning.',
                            'Block C', '214', '11111111-1111-4111-8111-111111111111') as r
 where r.created;

select is((select count(*)::int from t_ids where label = 'first'), 1, 'create_ticket reports a new ticket');

select results_eq(
  $$ select created_by, title, status::text, category::text, priority::text, version, assigned_department_id
       from public.complaints where id = (select id from t_ids where label = 'first') $$,
  $$ values ('a1000000-0000-4000-8000-00000000000a'::uuid, 'Ceiling fan broken', 'submitted', 'unclassified',
             'unassessed', 1, null::uuid) $$,
  'the ticket is owned by the caller, trimmed, and starts submitted/unclassified/unassessed at version 1'
);

select results_eq(
  $$ select event_type::text, actor_id, actor_kind::text, previous_status::text, new_status::text
       from public.ticket_events where complaint_id = (select id from t_ids where label = 'first') $$,
  $$ values ('created', 'a1000000-0000-4000-8000-00000000000a'::uuid, 'user', null::text, 'submitted') $$,
  'exactly one CREATED event is written in the same transaction'
);

select ok(
  (select reference_no from t_ids where label = 'first') >= 1001,
  'tickets get a human-friendly reference number starting at 1001'
);

-- ---------------------------------------------------------------------------------------------
-- Idempotency (BR-08, P2.07)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select id, created from public.create_ticket('Ceiling fan broken', 'The ceiling fan in room 214 stopped spinning.',
                                                   'Block C', '214', '11111111-1111-4111-8111-111111111111') $$,
  $$ select id, false from t_ids where label = 'first' $$,
  'repeating the same key returns the original ticket and reports it as not created'
);

select results_eq(
  $$ select id from public.create_ticket(' Ceiling fan broken', 'The ceiling fan in room 214 stopped spinning.  ',
                                           ' Block C ', '214 ', '11111111-1111-4111-8111-111111111111') $$,
  $$ select id from t_ids where label = 'first' $$,
  'whitespace differences do not count as different content'
);

select throws_ok(
  $$ select * from public.create_ticket('Window latch broken', 'A completely different problem to report.',
                                         'Block C', '214', '11111111-1111-4111-8111-111111111111') $$,
  'MR409', null,
  'reusing a key for different content is refused instead of returning a mismatched ticket'
);

select is(
  (select count(*)::int from public.complaints where created_by = 'a1000000-0000-4000-8000-00000000000a'),
  1,
  'retries created no duplicate complaint'
);

select is(
  (select count(*)::int from public.ticket_events where complaint_id = (select id from t_ids where label = 'first')),
  1,
  'retries created no duplicate event'
);

insert into t_ids
select 'second', r.id, r.reference_no
  from public.create_ticket('Leaking tap in lab', 'The tap in chemistry lab 2 drips constantly.',
                            'Science Block', null, '22222222-2222-4222-8222-222222222222') as r;

select ok(
  (select reference_no from t_ids where label = 'second') > (select reference_no from t_ids where label = 'first'),
  'a new key creates a new ticket with the next reference number'
);

select is(
  (select room from public.complaints where id = (select id from t_ids where label = 'second')),
  null,
  'an omitted room is stored as null'
);

-- ---------------------------------------------------------------------------------------------
-- Validation backstop (Zod validates first; the database still refuses bad data)
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.create_ticket('Fan', 'Long enough description here.', 'Block C', null, gen_random_uuid()) $$,
  '23514', null, 'a title under 5 characters is refused'
);

select throws_ok(
  $$ select * from public.create_ticket('Valid title', repeat('x', 3001), 'Block C', null, gen_random_uuid()) $$,
  '23514', null, 'a description over 3000 characters is refused'
);

select throws_ok(
  $$ select * from public.create_ticket('Valid title', 'Long enough description here.', 'Block C', null, null) $$,
  '22004', null, 'a missing idempotency key is refused'
);

-- ---------------------------------------------------------------------------------------------
-- Direct writes are impossible (P2.09: injected status/role/owner fields have no path in)
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.complaints (created_by, title, description, building, status)
     values ('b1000000-0000-4000-8000-00000000000b', 'Forged ticket', 'Pretending to be student B.', 'Block A', 'resolved') $$,
  '42501', null, 'a student cannot insert complaints directly'
);

select throws_ok(
  $$ update public.complaints set status = 'closed' where id = (select id from t_ids where label = 'first') $$,
  '42501', null, 'a student cannot change the status of their own ticket'
);

select throws_ok(
  $$ update public.complaints set created_by = 'b1000000-0000-4000-8000-00000000000b'
      where id = (select id from t_ids where label = 'first') $$,
  '42501', null, 'the owner of a ticket cannot be rewritten (BR-01)'
);

select throws_ok(
  $$ delete from public.complaints where id = (select id from t_ids where label = 'first') $$,
  '42501', null, 'a student cannot delete a ticket'
);

select throws_ok(
  $$ insert into public.ticket_events (complaint_id, event_type, actor_kind)
     values ((select id from t_ids where label = 'first'), 'created', 'system') $$,
  '42501', null, 'a student cannot forge timeline events'
);

select throws_ok(
  $$ select * from public.submission_keys $$, '42501', null, 'idempotency keys are not readable'
);

reset role;

-- ---------------------------------------------------------------------------------------------
-- Read isolation (BR-10, P2.08)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('b1000000-0000-4000-8000-00000000000b');

insert into t_ids
select 'b_first', r.id, r.reference_no
  from public.create_ticket('Broken chair in library', 'One of the chairs near the window is broken.',
                            'Library', null, '11111111-1111-4111-8111-111111111111') as r;

select ok(
  (select id from t_ids where label = 'b_first') <> (select id from t_ids where label = 'first'),
  'idempotency keys are scoped per user: the same key from another student is a new ticket'
);

select is(
  (select count(*)::int from public.complaints where created_by <> 'b1000000-0000-4000-8000-00000000000b'),
  0,
  'student B sees none of student A''s tickets'
);

select is(
  (select count(*)::int from public.ticket_events where complaint_id = (select id from t_ids where label = 'first')),
  0,
  'student B sees none of student A''s timeline'
);

select is(
  (select count(*)::int from public.list_complaints(50)
    where created_by <> 'b1000000-0000-4000-8000-00000000000b'),
  0,
  'list_complaints returns only what RLS allows'
);

reset role;

-- Department staff only see what is assigned to their department.
select pg_temp.act_as('c1000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.complaints), 0, 'department staff see no unassigned tickets');
reset role;

update public.complaints set assigned_department_id = 'd1000000-0000-4000-8000-000000000001', status = 'assigned'
 where id = (select id from t_ids where label = 'first');

select pg_temp.act_as('c1000000-0000-4000-8000-00000000000c');
select results_eq(
  $$ select id from public.complaints $$,
  $$ select id from t_ids where label = 'first' $$,
  'electrical staff see the ticket assigned to their department'
);
select is(
  (select count(*)::int from public.ticket_events where complaint_id = (select id from t_ids where label = 'first')),
  1,
  'and its timeline'
);
reset role;

select pg_temp.act_as('c2000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.complaints), 0, 'plumbing staff do not see electrical tickets');
reset role;

select pg_temp.act_as('e1000000-0000-4000-8000-00000000000e');
select is(
  (select count(*)::int from public.complaints where id in (select id from t_ids)),
  (select count(*)::int from t_ids),
  'an admin sees every ticket'
);
reset role;

select pg_temp.act_as_anon();
select throws_ok($$ select * from public.complaints $$, '42501', null, 'anonymous visitors cannot read tickets');
select throws_ok(
  $$ select * from public.create_ticket('Anonymous report', 'No account behind this report.', 'Block A', null, gen_random_uuid()) $$,
  '42501', null, 'anonymous visitors cannot create tickets'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Audit immutability: even the table owner cannot rewrite history
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ update public.ticket_events set note = 'rewritten' $$,
  '42501', null, 'ticket_events rejects UPDATE for every role, including the owner'
);

-- ---------------------------------------------------------------------------------------------
-- Keyset pagination (P2.06)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-00000000000a');
select results_eq(
  $$ with first_page as (select * from public.list_complaints(1)),
          second_page as (
            select * from public.list_complaints(1, (select created_at from first_page), (select id from first_page))
          )
     select (select count(*)::int from first_page) + (select count(*)::int from second_page),
            (select id from first_page) <> (select id from second_page) $$,
  $$ values (2, true) $$,
  'two pages of size 1 return two different tickets'
);
select results_eq(
  $$ select id from public.list_complaints(50, null, null, array['submitted']::public.ticket_state[]) $$,
  $$ select id from t_ids where label = 'second' $$,
  'list_complaints filters by a set of statuses (the assigned ticket is excluded)'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Durable rate limit: 20 tickets per user per 10 minutes
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('f1000000-0000-4000-8000-00000000000f');
do $$
begin
  for i in 1..20 loop
    perform public.create_ticket('Synthetic issue ' || i, 'Synthetic description number ' || i || '.',
                                 'Block D', null, ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid);
  end loop;
end;
$$;

select is(
  (select count(*)::int from public.complaints where created_by = 'f1000000-0000-4000-8000-00000000000f'),
  20, 'twenty tickets in a burst are accepted'
);
select throws_ok(
  $$ select * from public.create_ticket('One too many', 'The twenty-first ticket in ten minutes.', 'Block D', null, gen_random_uuid()) $$,
  'MR429', null, 'the twenty-first ticket within ten minutes is refused'
);
select lives_ok(
  $$ select * from public.create_ticket('Synthetic issue 7', 'Synthetic description number 7.', 'Block D', null,
                                         '00000000-0000-4000-8000-000000000007') $$,
  'a retry with an existing key still succeeds at the limit (it is not a new submission)'
);
reset role;

select * from finish();
rollback;
