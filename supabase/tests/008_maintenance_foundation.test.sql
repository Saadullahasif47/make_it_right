-- Maintenance foundation (Advanced Features plan v2 A0.03-A0.05, §04 M1-M6).
-- One ticket is walked through its life while its case mirrors it; every refused write to the new
-- tables is asserted, and the synthetic campus history is reset twice.
begin;
create extension if not exists pgtap with schema extensions;

select plan(70);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- The case of a ticket, read as the owner (bypasses RLS).
create function pg_temp.case_of(p_ticket uuid) returns public.maintenance_cases
language sql as $$
  select mc.* from public.maintenance_cases as mc
    join public.case_reports as cr on cr.case_id = mc.id
   where cr.complaint_id = p_ticket
$$;

create function pg_temp.ticket_version(p_ticket uuid) returns integer
language sql as $$ select version from public.complaints where id = p_ticket $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.ticket_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into public.departments (id, code, name) values
  ('d8000000-0000-4000-8000-000000000001', 'mf_elec', 'MF Electrical'),
  ('d8000000-0000-4000-8000-000000000002', 'mf_plumb', 'MF Plumbing');

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a8000000-0000-4000-8000-00000000000a', 'mf.owner@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"MF Owner"}'),
  ('b8000000-0000-4000-8000-00000000000b', 'mf.other@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"MF Other"}'),
  ('c8000000-0000-4000-8000-00000000000c', 'mf.elec@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"MF Elec"}'),
  ('c8100000-0000-4000-8000-00000000000c', 'mf.plumb@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"MF Plumb"}'),
  ('e8000000-0000-4000-8000-00000000000e', 'mf.admin@makeitright.test', 'authenticated', 'authenticated', '{"display_name":"MF Admin"}');

update public.profiles set role = 'department', department_id = 'd8000000-0000-4000-8000-000000000001'
 where id = 'c8000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'department', department_id = 'd8000000-0000-4000-8000-000000000002'
 where id = 'c8100000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'e8000000-0000-4000-8000-00000000000e';

insert into public.maintenance_locations (id, building_code, building_name, floor, room_code, display_name, map_x, map_y) values
  ('f8000000-0000-4000-8000-000000000001', 'MFT', 'Foundation Test Hall', 1, 'R-101', 'Foundation Test Hall, R-101', 100, 100),
  ('f8000000-0000-4000-8000-000000000002', 'MFT', 'Foundation Test Hall', 1, 'R-102', 'Foundation Test Hall, R-102', 300, 100);

insert into public.asset_registry (id, location_id, asset_code, asset_type, label) values
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'PRJ-MFT-101', 'projector', 'Test projector');

create temp table t (name text primary key, id uuid not null);
grant all on t to authenticated;

select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
insert into t select 'main', r.id
  from public.create_ticket('Foundation ticket', 'A ticket walked through every case mirror step.',
                            ' mft ', 'r-101', gen_random_uuid()) as r;
insert into t select 'unknown', r.id
  from public.create_ticket('Unknown room ticket', 'A ticket whose building is not on the campus map.',
                            'Somewhere Else', '9', gen_random_uuid()) as r;
reset role;
insert into t select name || '_case', (pg_temp.case_of(id)).id from t;

-- ---------------------------------------------------------------------------------------------
-- Schema (M1, M6)
-- ---------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_extension where extname = 'vector'), 'pgvector is installed');
select ok(exists (select 1 from pg_extension where extname = 'pgmq'), 'pgmq is installed');

select table_privs_are('public', 'maintenance_cases', 'authenticated', array['SELECT'],
  'signed-in users may only read maintenance_cases');
select table_privs_are('public', 'case_reports', 'authenticated', array['SELECT'],
  'signed-in users may only read case_reports');
select table_privs_are('public', 'case_events', 'authenticated', array['SELECT'],
  'signed-in users may only read case_events');
select table_privs_are('public', 'evidence_attachments', 'authenticated', array['SELECT'],
  'signed-in users may only read evidence_attachments');
select table_privs_are('public', 'ai_jobs', 'authenticated', array['SELECT'],
  'signed-in users may only read ai_jobs');
select table_privs_are('public', 'maintenance_locations', 'authenticated', array['SELECT'],
  'signed-in users may only read maintenance_locations');
select table_privs_are('public', 'asset_registry', 'authenticated', array['SELECT'],
  'signed-in users may only read asset_registry');

select ok(
  not has_function_privilege('authenticated', 'private.reset_synthetic_campus_history()', 'execute')
  and not has_function_privilege('authenticated', 'private.locate_unknown_cases()', 'execute')
  and not has_function_privilege('authenticated', 'private.open_case_for_complaint(public.complaints, text)', 'execute'),
  'signed-in users cannot run the case or demo-data functions'
);

-- ---------------------------------------------------------------------------------------------
-- A new report opens its own case (M2)
-- ---------------------------------------------------------------------------------------------
select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'open'::public.maintenance_case_status,
  'a new ticket opens a case in status open');
select is((pg_temp.case_of((select id from t where name = 'main'))).location_id, 'f8000000-0000-4000-8000-000000000001'::uuid,
  'the case location is matched from the report text, ignoring case and outer spaces');
select is((pg_temp.case_of((select id from t where name = 'unknown'))).location_id, null,
  'an unmatched building leaves the location UNKNOWN');
select is(
  (select array_agg(e.event_type::text) from public.case_events as e
    where e.case_id = (pg_temp.case_of((select id from t where name = 'main'))).id),
  array['opened'],
  'opening the case is recorded as one opened event'
);
select is(
  (select linked_by from public.case_reports where complaint_id = (select id from t where name = 'main')),
  null,
  'the system, not a person, linked the report to its own case'
);

-- A change that does not alter the case (submitted -> triaging are both "open") writes nothing.
update public.complaints set status = 'triaging' where id = (select id from t where name = 'main');
select is((pg_temp.case_of((select id from t where name = 'main'))).version, 1,
  'a ticket change that maps to the same case status does not bump the case version');
update public.complaints set status = 'submitted' where id = (select id from t where name = 'main');

-- ---------------------------------------------------------------------------------------------
-- The case mirrors the audited ticket workflow
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('e8000000-0000-4000-8000-00000000000e');
select lives_ok(
  format($$ select * from public.assign_ticket(%L, 'd8000000-0000-4000-8000-000000000001', 'electrical', 'medium', %s) $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the admin assigns the ticket'
);
reset role;

select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'assigned'::public.maintenance_case_status,
  'assignment moves the case to assigned');
select is((pg_temp.case_of((select id from t where name = 'main'))).assigned_department_id,
  'd8000000-0000-4000-8000-000000000001'::uuid, 'the case takes the ticket''s department');
select is((pg_temp.case_of((select id from t where name = 'main'))).category, 'electrical'::public.complaint_category,
  'the case takes the ticket''s category');
select is((pg_temp.case_of((select id from t where name = 'main'))).version, 2, 'assignment bumps the case version once');

-- Read access, now that the case belongs to a department.
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.maintenance_cases), 0, 'a student sees no maintenance cases, not even their own');
select is((select count(*)::int from public.case_reports), 0, 'a student sees no case links');
select is((select count(*)::int from public.case_events), 0, 'a student sees no case events');
select is((select count(*)::int from public.maintenance_locations where building_code = 'MFT'), 2,
  'a student can read campus locations');

select pg_temp.act_as('c8000000-0000-4000-8000-00000000000c');
select is(
  (select count(*)::int from public.maintenance_cases where id = (select id from t where name = 'main_case')),
  1, 'staff of the assigned department see the case'
);
select is(
  (select count(*)::int from public.case_events where case_id = (select id from t where name = 'main_case')),
  2, 'staff of the assigned department see its history'
);
select is(
  (select count(*)::int from public.maintenance_cases where assigned_department_id is distinct from 'd8000000-0000-4000-8000-000000000001'),
  0, 'department staff see no case of another department'
);
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'in_progress', %s) $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the electrician starts work on the ticket'
);

select pg_temp.act_as('c8100000-0000-4000-8000-00000000000c');
select is(
  (select count(*)::int from public.maintenance_cases where id = (select id from t where name = 'main_case')),
  0, 'staff of another department do not see the case'
);

select pg_temp.act_as('e8000000-0000-4000-8000-00000000000e');
select is(
  (select count(*)::int from public.maintenance_cases where id = (select id from t where name = 'main_case')),
  1, 'an admin sees the case'
);
reset role;

select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'in_progress'::public.maintenance_case_status,
  'starting work moves the case to in_progress');

select pg_temp.act_as('c8000000-0000-4000-8000-00000000000c');
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'resolved', %s, 'Replaced the faulty switch.') $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the electrician resolves the ticket'
);
reset role;
select ok((pg_temp.case_of((select id from t where name = 'main'))).resolved_at is not null,
  'resolving records when the case was resolved');

select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'reopened', %s, 'Still flickering today.') $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the reporter disputes the fix'
);
reset role;
select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'reopened'::public.maintenance_case_status,
  'a dispute reopens the case');
select is((pg_temp.case_of((select id from t where name = 'main'))).resolved_at, null,
  'reopening clears the resolution time');

select pg_temp.act_as('c8000000-0000-4000-8000-00000000000c');
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'in_progress', %s) $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the electrician resumes work'
);
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'resolved', %s, 'Replaced the ballast as well.') $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the electrician resolves it again'
);
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select lives_ok(
  format($$ select * from public.transition_ticket(%L, 'closed', %s) $$,
         (select id from t where name = 'main'), pg_temp.ticket_version((select id from t where name = 'main'))),
  'the reporter confirms and closes the ticket'
);
reset role;

select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'closed'::public.maintenance_case_status,
  'closing the ticket closes its case');
select ok((pg_temp.case_of((select id from t where name = 'main'))).closed_at is not null, 'the case records when it closed');
select is(
  (select array_agg(e.event_type::text || ':' || coalesce(e.new_status::text, '-') order by e.id)
     from public.case_events as e where e.case_id = (pg_temp.case_of((select id from t where name = 'main'))).id),
  array['opened:open', 'assigned:assigned', 'status_changed:in_progress', 'status_changed:resolved',
        'status_changed:reopened', 'status_changed:in_progress', 'status_changed:resolved', 'status_changed:closed'],
  'the case timeline has one event per ticket change, in order'
);

-- ---------------------------------------------------------------------------------------------
-- Nobody writes the new tables directly (A0.04)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select throws_ok(
  format($$ update public.maintenance_cases set status = 'closed' where id = %L $$,
         (select id from t where name = 'unknown_case')),
  '42501', null, 'a student cannot change a case status'
);
select throws_ok(
  format($$ insert into public.case_reports (complaint_id, case_id) values (%L, %L) $$,
         (select id from t where name = 'unknown'), (select id from t where name = 'main_case')),
  '42501', null, 'a student cannot link reports to a case'
);
select throws_ok(
  $$ insert into public.ai_jobs (job_type, target_id, dedupe_key) values ('visual_analysis', gen_random_uuid(), 'student-forged-job') $$,
  '42501', null, 'a student cannot create AI jobs'
);

select pg_temp.act_as('c8000000-0000-4000-8000-00000000000c');
select throws_ok(
  format($$ update public.maintenance_cases set assigned_department_id = null where id = %L $$,
         (select id from t where name = 'main_case')),
  '42501', null, 'department staff cannot change a case directly'
);

select pg_temp.act_as('e8000000-0000-4000-8000-00000000000e');
select throws_ok(
  format($$ delete from public.case_events where case_id = %L $$, (select id from t where name = 'main_case')),
  '42501', null, 'an admin cannot delete case history'
);
reset role;

select throws_ok(
  format($$ update public.case_events set note = 'rewritten' where case_id = %L $$,
         (select id from t where name = 'main_case')),
  '42501', 'case_events is append-only', 'case history is append-only even for the table owner'
);

-- ---------------------------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  format($$ insert into public.case_reports (complaint_id, case_id) values (%L, %L) $$,
         (select id from t where name = 'main'), (select id from t where name = 'unknown_case')),
  '23505', null, 'a complaint can belong to only one case'
);
select throws_ok(
  $$ insert into public.maintenance_cases (location_id, asset_id)
     values ('f8000000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a case cannot name an asset that is in a different room'
);
select throws_ok(
  $$ insert into public.maintenance_locations (building_code, building_name, floor, room_code, display_name)
     values ('MFT', 'Foundation Test Hall', 1, 'R-101', 'Duplicate room') $$,
  '23505', null, 'a building, floor and room exist only once'
);
select throws_ok(
  $$ insert into public.maintenance_locations (building_code, building_name, floor, room_code, display_name)
     values ('mft', 'Foundation Test Hall', 1, 'R-109', 'Lower-case code') $$,
  '23514', null, 'location codes must be stored normalised'
);
select throws_ok(
  $$ insert into public.evidence_attachments (uploaded_by, object_path, mime_type, byte_size)
     values ('a8000000-0000-4000-8000-00000000000a',
             'a8000000-0000-4000-8000-00000000000a/a8000000-0000-4000-8000-000000000001.jpg', 'image/jpeg', 1000) $$,
  '23514', null, 'an attachment must belong to a complaint or a case'
);
select throws_ok(
  format($$ insert into public.evidence_attachments (complaint_id, uploaded_by, object_path, mime_type, byte_size)
            values (%L, 'a8000000-0000-4000-8000-00000000000a',
                    'a8000000-0000-4000-8000-00000000000a/a8000000-0000-4000-8000-000000000002.gif', 'image/gif', 1000) $$,
         (select id from t where name = 'main')),
  '23514', null, 'only JPEG, PNG and WebP images are accepted'
);
select throws_ok(
  format($$ insert into public.evidence_attachments (complaint_id, uploaded_by, object_path, mime_type, byte_size)
            values (%L, 'a8000000-0000-4000-8000-00000000000a',
                    'a8000000-0000-4000-8000-00000000000a/a8000000-0000-4000-8000-000000000003.jpg', 'image/jpeg', 2097153) $$,
         (select id from t where name = 'main')),
  '23514', null, 'an image over 2 MB is refused'
);
select throws_ok(
  format($$ insert into public.evidence_attachments (complaint_id, uploaded_by, object_path, mime_type, byte_size)
            values (%L, 'a8000000-0000-4000-8000-00000000000a', '../escape.jpg', 'image/jpeg', 1000) $$,
         (select id from t where name = 'main')),
  '23514', null, 'an object path outside the uploader folder is refused'
);

insert into public.evidence_attachments (complaint_id, uploaded_by, object_path, mime_type, byte_size)
select id, 'a8000000-0000-4000-8000-00000000000a',
       'a8000000-0000-4000-8000-00000000000a/a8000000-0000-4000-8000-000000000004.png', 'image/png', 1000
  from t where name = 'main';
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.evidence_attachments), 1, 'the reporter sees the photo on their complaint');
select pg_temp.act_as('b8000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.evidence_attachments), 0, 'another student cannot see it');
reset role;

insert into public.ai_jobs (job_type, target_id, dedupe_key) values ('visual_analysis', gen_random_uuid(), 'mf-dedupe-key-1');
select throws_ok(
  $$ insert into public.ai_jobs (job_type, target_id, dedupe_key) values ('visual_analysis', gen_random_uuid(), 'mf-dedupe-key-1') $$,
  '23505', null, 'a dedupe key names one job only'
);
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.ai_jobs where dedupe_key = 'mf-dedupe-key-1'), 0, 'a student cannot read AI jobs');
select pg_temp.act_as('e8000000-0000-4000-8000-00000000000e');
select is((select count(*)::int from public.ai_jobs where dedupe_key = 'mf-dedupe-key-1'), 1, 'an admin can read AI jobs');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Deleting a report removes its empty case; a shared case follows its reports (A3)
-- ---------------------------------------------------------------------------------------------
delete from public.case_reports where complaint_id = (select id from t where name = 'unknown');
select is((select count(*)::int from public.maintenance_cases where id = (select id from t where name = 'unknown_case')), 0,
  'a case left without reports is removed');
insert into public.case_reports (complaint_id, case_id)
select (select id from t where name = 'unknown'), (pg_temp.case_of(id)).id from t where name = 'main';

update public.complaints set status = 'needs_review' where id = (select id from t where name = 'unknown');
-- Since A3 a shared case is led by operational changes on any of its reports (ADR 0011).
select is((pg_temp.case_of((select id from t where name = 'main'))).status, 'needs_review'::public.maintenance_case_status,
  'an operational change on one report of a shared case updates the case (A3)');

-- ---------------------------------------------------------------------------------------------
-- Late locations and the synthetic campus history (A0.05)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a8000000-0000-4000-8000-00000000000a');
insert into t select 'late', r.id
  from public.create_ticket('Late room ticket', 'A ticket filed before its room was on the campus map.',
                            'MFT', 'R-103', gen_random_uuid()) as r;
reset role;
insert into public.maintenance_locations (building_code, building_name, floor, room_code, display_name)
values ('MFT', 'Foundation Test Hall', 1, 'R-103', 'Foundation Test Hall, R-103');
select private.locate_unknown_cases();
select is(
  (select l.room_code from public.maintenance_locations as l
    where l.id = (pg_temp.case_of((select id from t where name = 'late'))).location_id),
  'R-103', 'a case filed before its room existed is located once the room is added'
);

select is(private.reset_synthetic_campus_history(), 60, 'the demo history has 60 cases');
select is(private.reset_synthetic_campus_history(), 60, 'resetting it again succeeds');
select is((select count(*)::int from public.maintenance_cases where is_synthetic), 60,
  'a second reset replaces the demo cases instead of adding to them');
select is(
  (select count(*)::int from public.maintenance_cases as mc
     join public.asset_registry as a on a.id = mc.asset_id
    where a.asset_code = 'PRJ-ENG-204' and mc.is_synthetic and mc.opened_at > now() - interval '30 days'),
  3, 'the repeat-failure projector has three cases in 30 days'
);
select is(
  (select count(*)::int from public.case_reports where complaint_id in (select id from t where name in ('main', 'unknown', 'late'))),
  3, 'resetting the demo history leaves real cases and their reports untouched'
);

select * from finish();
rollback;
