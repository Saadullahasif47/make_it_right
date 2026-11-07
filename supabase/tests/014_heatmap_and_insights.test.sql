-- Campus heatmap and maintenance insights (Advanced Features plan v2 F5.01-F6.06, A6.01-A6.04):
-- distinct cases (never reports), admin-only analytics, deterministic rules with deduplicated
-- alerts, and a staff location picker that keeps similar equipment apart.
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
grant execute on function pg_temp.act_as(uuid) to authenticated;

create function pg_temp.case_of(p_ticket uuid) returns uuid
language sql as $$ select case_id from public.case_reports where complaint_id = p_ticket $$;
grant execute on function pg_temp.case_of(uuid) to authenticated;

create function pg_temp.asset(p_code text) returns uuid
language sql as $$ select id from public.asset_registry where asset_code = p_code $$;
grant execute on function pg_temp.asset(text) to authenticated;

create function pg_temp.room(p_building text, p_room text) returns uuid
language sql as $$ select id from public.maintenance_locations where building_code = p_building and room_code = p_room $$;
grant execute on function pg_temp.room(text, text) to authenticated;

-- One room's entry in a heatmap result.
create function pg_temp.room_in(p_map jsonb, p_room uuid) returns jsonb
language sql as $$ select r from jsonb_array_elements(p_map -> 'rooms') as r where (r ->> 'location_id')::uuid = p_room $$;
grant execute on function pg_temp.room_in(jsonb, uuid) to authenticated;

create function pg_temp.active_alert(p_rule text, p_subject text) returns public.maintenance_alerts
language sql as $$
  select * from public.maintenance_alerts
   where rule_code = p_rule and subject_key = p_subject and status in ('open', 'acknowledged')
$$;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('ae000000-0000-4000-8000-00000000000a', 'hm.student@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ce000000-0000-4000-8000-00000000000c', 'hm.it@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('de000000-0000-4000-8000-00000000000d', 'hm.plumbing@makeitright.test', 'authenticated', 'authenticated', '{}'),
  ('ee000000-0000-4000-8000-00000000000e', 'hm.admin@makeitright.test', 'authenticated', 'authenticated', '{}');
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'it_services')
 where id = 'ce000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = (select id from public.departments where code = 'plumbing')
 where id = 'de000000-0000-4000-8000-00000000000d';
update public.profiles set role = 'admin' where id = 'ee000000-0000-4000-8000-00000000000e';

create temp table t (name text primary key, id uuid, n integer, j jsonb);
grant all on t to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Privileges: analytics are for administrators only
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants
            where table_name in ('maintenance_alerts', 'maintenance_alert_events', 'maintenance_sla_policies')
              and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0,
  'API roles can only read alerts, their events and the targets');
select ok(not has_function_privilege('authenticated', 'private.refresh_maintenance_alerts()', 'execute'),
  'signed-in users cannot run the rule refresh directly');
select pg_temp.act_as('ae000000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_heatmap() $$, 'MR403', null, 'a student cannot read the heatmap');
select throws_ok($$ select public.admin_maintenance_insights() $$, 'MR403', null, 'a student cannot read insights');
select is((select count(*)::int from public.maintenance_alerts), 0, 'a student sees no alerts');
select pg_temp.act_as('ce000000-0000-4000-8000-00000000000c');
select throws_ok($$ select public.admin_heatmap() $$, 'MR403', null, 'department staff cannot read the heatmap');
select throws_ok($$ select public.admin_refresh_alerts() $$, 'MR403', null, 'department staff cannot refresh alerts');
reset role;

-- ---------------------------------------------------------------------------------------------
-- The seeded history's known issues (F6.06 backtest)
-- ---------------------------------------------------------------------------------------------
select isnt(pg_temp.active_alert('REPEAT_30D', 'asset:' || pg_temp.asset('PRJ-ENG-204')), null,
  'REPEAT_30D flags the projector with three cases in 30 days');
select is(pg_temp.active_alert('REPEAT_30D', 'asset:' || pg_temp.asset('PRJ-ENG-203')), null,
  'the similar projector next door (one case) is not flagged');
select isnt(pg_temp.active_alert('BUILDING_CLUSTER', 'building:ENG'), null, 'BUILDING_CLUSTER flags Engineering (6 cases)');
select is((select count(*)::int from public.maintenance_alerts
            where rule_code = 'BUILDING_CLUSTER' and building_code in ('SCI', 'LIB') and status <> 'cleared'), 0,
  'buildings with 3 and 2 cases are not clusters');
select isnt(pg_temp.active_alert('RECENT_REOPEN', 'case:' || (select id from public.maintenance_cases
             where asset_id = pg_temp.asset('SNK-SCI-205') and is_synthetic)), null,
  'RECENT_REOPEN flags the sink reopened 3 days after its repair');
select isnt(pg_temp.active_alert('LONG_UNRESOLVED', 'case:' || (select id from public.maintenance_cases
             where asset_id = pg_temp.asset('ACU-LIB-101') and is_synthetic)), null,
  'LONG_UNRESOLVED flags the AC unit assigned 21 days ago (target 7)');
select is(pg_temp.active_alert('LONG_UNRESOLVED', 'case:' || (select id from public.maintenance_cases
            where asset_id = pg_temp.asset('PRJ-ENG-204') and is_synthetic and status = 'in_progress')), null,
  'a case within its target is not flagged');

-- ---------------------------------------------------------------------------------------------
-- Deduplication (F6.03)
-- ---------------------------------------------------------------------------------------------
insert into t (name, n) select 'active_before', count(*)::int from public.maintenance_alerts where status in ('open', 'acknowledged');
insert into t (name, n) select 'repeat_checks', refresh_count from pg_temp.active_alert('REPEAT_30D', 'asset:' || pg_temp.asset('PRJ-ENG-204'));
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
select is((public.admin_refresh_alerts() ->> 'raised')::int, 0, 'running the refresh again raises nothing new');
reset role;
select is((select count(*)::int from public.maintenance_alerts where status in ('open', 'acknowledged')),
  (select n from t where name = 'active_before'), 'and keeps exactly the same active alerts');
select is((pg_temp.active_alert('REPEAT_30D', 'asset:' || pg_temp.asset('PRJ-ENG-204'))).refresh_count,
  (select n + 1 from t where name = 'repeat_checks'), 'the existing alert records one more check');
select throws_ok(
  $$ insert into public.maintenance_alerts (rule_code, subject_key, level, window_start, window_end, case_ids)
     select rule_code, subject_key, level, window_start, window_end, case_ids from public.maintenance_alerts
      where rule_code = 'BUILDING_CLUSTER' and subject_key = 'building:ENG' and status = 'open' $$,
  '23505', null, 'the database refuses a second active alert for the same rule and subject');

-- ---------------------------------------------------------------------------------------------
-- Heatmap counts (F5.02, F5.05)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
insert into t (name, n) select 'unknown_before', (public.admin_heatmap(90, null, null, null, null, 'all', false) -> 'unknown' ->> 'cases')::int;
reset role;
select pg_temp.act_as('ae000000-0000-4000-8000-00000000000a');
insert into t (name, id) select 'first', r.id from public.create_ticket('Projector flickers', 'The projector flickers in the lab.', 'ENG', 'LAB-203', gen_random_uuid()) as r;
insert into t (name, id) select 'second', r.id from public.create_ticket('Projector again', 'Same projector flickering.', 'Engineering Block', 'lab-203', gen_random_uuid()) as r;
insert into t (name, id) select 'nowhere', r.id from public.create_ticket('Broken bench', 'A bench is broken.', 'Nowhere Hall', 'X1', gen_random_uuid()) as r;
reset role;
-- Link the second report into the first one's case, as an accepted duplicate would.
insert into t (name, id) select 'case_a', pg_temp.case_of((select id from t where name = 'first'));
insert into t (name, id) select 'case_b', pg_temp.case_of((select id from t where name = 'second'));
update public.case_reports set case_id = (select id from t where name = 'case_a')
 where complaint_id = (select id from t where name = 'second');
update public.maintenance_cases set status = 'merged', merged_into_case_id = (select id from t where name = 'case_a')
 where id = (select id from t where name = 'case_b');

select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
insert into t (name, j) select 'map', public.admin_heatmap(30, 'ENG', null, null, null, 'all', false);
select is((pg_temp.room_in((select j from t where name = 'map'), pg_temp.room('ENG', 'LAB-203')) ->> 'cases')::int, 1,
  'two reports of one problem count as one case');
select is((pg_temp.room_in((select j from t where name = 'map'), pg_temp.room('ENG', 'LAB-203')) ->> 'reports')::int, 2,
  'and the room still shows both reports');
select is(jsonb_array_length((select j from t where name = 'map') -> 'rooms'), 12,
  'a building filter keeps every room of the building, empty ones included');
select is((pg_temp.room_in((select j from t where name = 'map'), pg_temp.room('ENG', 'OFF-106')) ->> 'cases')::int, 0,
  'an empty room shows zero');
select is((public.admin_heatmap(90, null, null, null, null, 'all', false) -> 'unknown' ->> 'cases')::int,
  (select n + 1 from t where name = 'unknown_before'), 'a report with no known room is counted as unknown');
select is(jsonb_array_length(public.admin_heatmap_room(pg_temp.room('ENG', 'LAB-203'), 30, null, null, 'all', false)), 1,
  'the drilldown lists the one case of the room');
select is((pg_temp.room_in(public.admin_heatmap(30, 'ENG', null, null, null, 'done', false), pg_temp.room('ENG', 'LAB-203')) ->> 'cases')::int, 0,
  'the status filter excludes the still-open case');
reset role;
update public.maintenance_cases set opened_at = now() - interval '40 days' where id = (select id from t where name = 'case_a');
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
select is((pg_temp.room_in(public.admin_heatmap(30, 'ENG', null, null, null, 'all', false), pg_temp.room('ENG', 'LAB-203')) ->> 'cases')::int, 0,
  'a case opened 40 days ago is outside the 30-day window');
select is((pg_temp.room_in(public.admin_heatmap(90, 'ENG', null, null, null, 'all', false), pg_temp.room('ENG', 'LAB-203')) ->> 'cases')::int, 1,
  'and inside the 90-day window');
select throws_ok($$ select public.admin_heatmap(14) $$, '22023', null, 'only 7, 30 or 90 days');

-- ---------------------------------------------------------------------------------------------
-- Room and equipment of a case (F5.01, F6.01)
-- ---------------------------------------------------------------------------------------------
select public.assign_ticket((select id from t where name = 'first'), (select id from public.departments where code = 'it_services'),
  'it_equipment', 'medium', (select version from public.complaints where id = (select id from t where name = 'first')));
reset role;
select pg_temp.act_as('de000000-0000-4000-8000-00000000000d');
select throws_ok(format($$ select public.set_case_location(%L, 1, null, %L) $$, (select id from t where name = 'case_a'), pg_temp.asset('PRJ-ENG-203')),
  'MR404', null, 'another department cannot place the case');
select pg_temp.act_as('ce000000-0000-4000-8000-00000000000c');
select throws_ok(format($$ select public.set_case_location(%L, 1, null, %L) $$, (select id from t where name = 'case_a'), pg_temp.asset('PRJ-ENG-203')),
  'MR412', null, 'an old page cannot place the case');
select throws_ok(format($$ select public.set_case_location(%L, %s, %L, %L) $$, (select id from t where name = 'case_a'),
  (select version from public.maintenance_cases where id = (select id from t where name = 'case_a')),
  pg_temp.room('ENG', 'LAB-204'), pg_temp.asset('PRJ-ENG-203')),
  '22023', null, 'equipment must be in the chosen room');
select lives_ok(format($$ select public.set_case_location(%L, %s, null, %L) $$, (select id from t where name = 'case_a'),
  (select version from public.maintenance_cases where id = (select id from t where name = 'case_a')), pg_temp.asset('PRJ-ENG-203')),
  'the holding department picks the equipment');
reset role;
select results_eq(
  format($$ select asset_id, location_id from public.maintenance_cases where id = %L $$, (select id from t where name = 'case_a')),
  format($$ values (%L::uuid, %L::uuid) $$, pg_temp.asset('PRJ-ENG-203'), pg_temp.room('ENG', 'LAB-203')),
  'the case gets that exact projector (not its look-alike) and its room');

-- ---------------------------------------------------------------------------------------------
-- Acknowledging, clearing and targets (F6.03-F6.04)
-- ---------------------------------------------------------------------------------------------
insert into t (name, id) select 'repeat', id from pg_temp.active_alert('REPEAT_30D', 'asset:' || pg_temp.asset('PRJ-ENG-204'));
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
select lives_ok(format($$ select public.admin_acknowledge_alert(%L, 'Technician booked.') $$, (select id from t where name = 'repeat')),
  'an administrator acknowledges an alert');
select throws_ok(format($$ select public.admin_acknowledge_alert(%L) $$, (select id from t where name = 'repeat')),
  'MR422', null, 'an alert is acknowledged once');
reset role;
-- One of the projector's cases is older than the window now: the rule stops holding.
update public.maintenance_cases set opened_at = now() - interval '45 days'
 where id = (select id from public.maintenance_cases where asset_id = pg_temp.asset('PRJ-ENG-204') and is_synthetic
              order by opened_at limit 1);
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
select public.admin_set_category_sla('electrical', 30);
select public.admin_refresh_alerts();
reset role;
select results_eq(
  format($$ select status::text, (select array_agg(event_type order by id) from public.maintenance_alert_events where alert_id = %L)
             from public.maintenance_alerts where id = %L $$, (select id from t where name = 'repeat'), (select id from t where name = 'repeat')),
  $$ values ('cleared', array['raised', 'acknowledged', 'cleared']) $$,
  'an alert whose rule no longer holds is cleared, with its whole history kept');
select is(pg_temp.active_alert('LONG_UNRESOLVED', 'case:' || (select id from public.maintenance_cases
            where asset_id = pg_temp.asset('ACU-LIB-101') and is_synthetic)), null,
  'raising the electrical target to 30 days clears the AC unit''s alert');
select pg_temp.act_as('ee000000-0000-4000-8000-00000000000e');
select throws_ok($$ select public.admin_set_category_sla('plumbing', 0) $$, '22023', null, 'a target is 1 to 90 days');
reset role;
select throws_ok($$ update public.maintenance_alert_events set note = 'changed' $$, '42501', null, 'alert history is append-only');

select * from finish();
rollback;
