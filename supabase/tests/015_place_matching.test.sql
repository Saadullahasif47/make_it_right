-- Forgiving place matching: the same building and room written differently are recognised, an
-- ambiguous or unknown place stays unknown, and duplicate features are never NULL.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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

create function pg_temp.axis(p_index integer) returns real[]
language sql as $$
  select array_agg(case when i = p_index then 1::real else 0::real end order by i) from generate_series(1, 768) as i
$$;

-- ---------------------------------------------------------------------------------------------
-- Normalising
-- ---------------------------------------------------------------------------------------------
select is(private.normalize_room('lab 103'), 'lab103', 'a room ignores spaces and case');
select is(private.normalize_room(' LAB-103 '), 'lab103', 'a room ignores hyphens and outer spaces');
select is(private.normalize_room('Room 204'), '204', 'a leading "Room" is dropped');
select is(private.normalize_room('room'), 'room', 'a room called only "room" is kept');
select ok(private.same_building_name('science', 'Science Block'), 'a short building name matches the full one');
select ok(private.same_building_name('ENGINEERING-BLOCK', 'engineering block'), 'building names ignore case and punctuation');
select ok(not private.same_building_name('Engineering Block', 'Science Block'), 'different buildings stay different');
select ok(not private.same_building_name('sc', 'Science Block'), 'fewer than 3 characters never matches a building');

-- ---------------------------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------------------------
insert into public.maintenance_locations (id, building_code, building_name, floor, room_code, display_name, map_x, map_y)
values ('aa150000-0000-4000-8000-000000000001', 'TSTX', 'Testing Hall', 9, 'LAB-901', 'Testing Hall, LAB-901', 100, 100);

select is(private.match_location('testing', 'lab 901'), 'aa150000-0000-4000-8000-000000000001'::uuid,
  'a short building name and a spaced room find the location');
select is(private.match_location('TSTX', 'Room LAB901'), 'aa150000-0000-4000-8000-000000000001'::uuid,
  'the building code and a "Room" prefix find the location');
select is(private.match_location('Testing Hall', 'lab 902'), null::uuid, 'a room that does not exist stays unknown');
select is(private.match_location('Testing Hall', ''), null::uuid, 'no room stays unknown');

-- ---------------------------------------------------------------------------------------------
-- Duplicate features
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('ab150000-0000-4000-8000-00000000000a', 'pm.one@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('bb150000-0000-4000-8000-00000000000b', 'pm.two@makeitright.test', 'authenticated', 'authenticated', '{}');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated, service_role;

select pg_temp.act_as('ab150000-0000-4000-8000-00000000000a');
insert into t select 'first', r.id
  from public.create_ticket('AC not cooling', 'The lab AC only blows warm air all day.', 'Testing Hall', 'LAB-901', gen_random_uuid()) as r;
select pg_temp.act_as('bb150000-0000-4000-8000-00000000000b');
insert into t select 'same_room', r.id
  from public.create_ticket('Air conditioner hot air', 'The air conditioner in the lab blows hot air.', 'testing', 'lab 901', gen_random_uuid()) as r;
insert into t select 'other_room', r.id
  from public.create_ticket('AC broken here', 'The AC in this room is not cooling at all.', 'Testing Hall', 'R5', gen_random_uuid()) as r;
reset role;

-- The first report's case is placed; the third report's room is not a known location.
update public.maintenance_cases set location_id = 'aa150000-0000-4000-8000-000000000001'
 where id = (select case_id from public.case_reports where complaint_id = (select id from t where name = 'first'));

insert into public.complaint_embeddings (complaint_id, model, embedding, text_hash)
select id, 'gemini-embedding-2', pg_temp.axis(1)::extensions.vector, repeat('e', 64) from t;

select pg_temp.act_as_service();
create temp table f_same as
  select * from public.worker_duplicate_features((select id from t where name = 'same_room'), 'gemini-embedding-2', 10);
create temp table f_other as
  select * from public.worker_duplicate_features((select id from t where name = 'other_room'), 'gemini-embedding-2', 10);
reset role;

select ok(
  (select same_room and same_building from f_same
    where case_id = (select case_id from public.case_reports where complaint_id = (select id from t where name = 'first'))),
  '"testing" / "lab 901" is the same building and room as "Testing Hall" / "LAB-901"');
select is(
  (select same_room from f_other
    where case_id = (select case_id from public.case_reports where complaint_id = (select id from t where name = 'first'))),
  false, 'a different room is false, not NULL, when only one side has a known location');
select is(
  (select count(*)::int from f_other where same_room is null or same_building is null or same_asset is null or category_match is null),
  0, 'no duplicate feature is ever NULL');
select ok((select bool_and(same_building) from f_other), 'the other room is still in the same building');

select * from finish();
rollback;
