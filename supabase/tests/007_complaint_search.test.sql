-- Search in ticket lists (UI redesign plan §5, Stage 3): what matches, what never matches, and
-- that searching cannot reach past RLS.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Titles of the caller's matches for a query, newest first, as one comparable array.
create function pg_temp.titles(q text, statuses public.ticket_state[] default null, sort text default 'newest')
returns text[]
language sql as $$
  select coalesce(array_agg(title), '{}') from public.list_complaints(50, null, null, statuses, sort, null, q)
$$;
-- Default privileges revoke EXECUTE from public; the helper runs as the signed-in caller.
grant execute on function pg_temp.titles(text, public.ticket_state[], text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixtures: student A owns four tickets, student B owns one with a title A also uses.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a7000000-0000-4000-8000-00000000000a', 'search.a@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"Search A"}'),
  ('b7000000-0000-4000-8000-00000000000b', 'search.b@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"Search B"}');

insert into public.complaints (created_by, title, description, building, room, status, created_at) values
  ('a7000000-0000-4000-8000-00000000000a', 'Ceiling fan not working', 'The fan in the lecture hall does not start.', 'Block C', '214', 'assigned', '2026-11-01 09:00+00'),
  ('a7000000-0000-4000-8000-00000000000a', 'Leaking tap', 'The tap by the window drips all day long.', 'Chemistry Lab', null, 'resolved', '2026-11-01 10:00+00'),
  ('a7000000-0000-4000-8000-00000000000a', 'Projector flickers', 'The projector image flickers every few seconds.', 'Library', 'Seminar 3', 'submitted', '2026-11-01 11:00+00'),
  ('a7000000-0000-4000-8000-00000000000a', '50% of lights out_now', 'Half of the corridor lights are not working.', 'Block C', null, 'submitted', '2026-11-01 12:00+00'),
  ('b7000000-0000-4000-8000-00000000000b', 'Ceiling fan not working', 'Student B has the same problem in a hostel.', 'Hostel A', '12', 'submitted', '2026-11-01 13:00+00');

create temp table t_refs as
  select title, reference_no from public.complaints where created_by = 'a7000000-0000-4000-8000-00000000000a';
grant select on t_refs to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The function itself
-- ---------------------------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc where oid = 'public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority, text)'::regprocedure),
  false,
  'list_complaints with search is SECURITY INVOKER, so RLS still applies'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_complaints'),
  1,
  'only one list_complaints exists: the old signature was replaced, not overloaded'
);

-- ---------------------------------------------------------------------------------------------
-- What matches (as student A)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a7000000-0000-4000-8000-00000000000a');

select is(cardinality(pg_temp.titles(null)), 4, 'no query lists every ticket the caller may see');
select is(cardinality(pg_temp.titles('   ')), 4, 'a blank query is no filter at all');
select is(pg_temp.titles('CEILING'), array['Ceiling fan not working'], 'title matches ignore case');
select is(pg_temp.titles('  tap '), array['Leaking tap'], 'the query is trimmed');
select is(
  pg_temp.titles('block c'),
  array['50% of lights out_now', 'Ceiling fan not working'],
  'building matches, newest first'
);
select is(pg_temp.titles('seminar'), array['Projector flickers'], 'room matches');
select is(
  pg_temp.titles('MIR-' || (select reference_no from t_refs where title = 'Leaking tap')),
  array['Leaking tap'],
  'a reference written as MIR-1234 matches its ticket'
);
select is(
  pg_temp.titles('mir' || (select reference_no from t_refs where title = 'Leaking tap')),
  array['Leaking tap'],
  'a reference written as mir1234 matches its ticket'
);
select is(
  pg_temp.titles((select reference_no from t_refs where title = 'Projector flickers')::text),
  array['Projector flickers'],
  'a bare reference number matches its ticket'
);
select is(pg_temp.titles('MIR-'), '{}'::text[], 'a prefix with no number matches nothing');

-- LIKE wildcards are ordinary characters.
select is(pg_temp.titles('%'), array['50% of lights out_now'], '% is matched literally, not as a wildcard');
select is(pg_temp.titles('_'), array['50% of lights out_now'], '_ is matched literally, not as a wildcard');
select is(pg_temp.titles('fan%'), '{}'::text[], 'a trailing % does not turn the text into a prefix search');

-- Search combines with the other list options.
select is(
  pg_temp.titles('block c', array['assigned']::public.ticket_state[]),
  array['Ceiling fan not working'],
  'search combines with a status filter'
);
select is(
  pg_temp.titles('block c', null, 'oldest'),
  array['Ceiling fan not working', '50% of lights out_now'],
  'search combines with the oldest-first sort'
);
select results_eq(
  $$ with first_page as (select * from public.list_complaints(1, null, null, null, 'newest', null, 'block c'))
     select title from public.list_complaints(1, (select created_at from first_page), (select id from first_page),
                                              null, 'newest', null, 'block c') $$,
  $$ values ('Ceiling fan not working') $$,
  'keyset pagination continues within the search results'
);

select throws_ok(
  $$ select * from public.list_complaints(20, null, null, null, 'newest', null, repeat('a', 101)) $$,
  '22023', 'search text is too long',
  'a query longer than 100 characters is refused'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Searching never reaches past RLS
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('b7000000-0000-4000-8000-00000000000b');
select is(
  pg_temp.titles('ceiling'),
  array['Ceiling fan not working'],
  'student B finds only their own ticket with a shared title'
);
select is(
  (select count(*)::int from public.list_complaints(50, null, null, null, 'newest', null, 'ceiling')
    where created_by <> 'b7000000-0000-4000-8000-00000000000b'),
  0,
  'none of student A''s tickets come back for student B'
);
select is(
  pg_temp.titles('MIR-' || (select reference_no from t_refs where title = 'Leaking tap')),
  '{}'::text[],
  'another student''s reference number finds nothing'
);
reset role;

select * from finish();
rollback;
