-- Fictional demo tickets for presentations (master plan P7.02). Safe to re-run.
--
-- Every ticket is created and moved through the workflow by calling the same audited functions
-- the application calls, while impersonating the demo account exactly as the Data API does
-- (request.jwt.claims plus the authenticated role). So each ticket has a genuine audit trail,
-- and no business rule is bypassed. Requires supabase/seed.sql and the demo accounts
-- (scripts/seed-demo-accounts.mts).
--
--   local:  docker exec -i supabase_db_makeitright psql -U postgres -d postgres < supabase/demo/demo-tickets.sql
--   cloud:  pnpm exec supabase db query --linked -f supabase/demo/demo-tickets.sql
--
-- Each ticket has a fixed idempotency key. On a re-run, create_ticket replays the existing ticket
-- and its story is skipped, so nothing is duplicated.
--
-- Steps, separated by "|":
--   assign|<department code>|<category>|<priority>|<note>   by the administrator
--   ack                                                     by the department's staff
--   start|<note>  note|<text>  resolve|<note>               by the department's staff
--   close  reopen|<note>                                    by the reporting student

create or replace function pg_temp.demo_act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- Called again after the first switch, so the impersonated role must be able to run it.
grant execute on function pg_temp.demo_act_as(uuid) to authenticated;

create or replace function pg_temp.demo_user(p_email text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users as u where u.email = p_email;
  if v_id is null then
    raise exception 'demo account % is missing: run scripts/seed-demo-accounts.mts first', p_email;
  end if;
  return v_id;
end;
$$;

create or replace function pg_temp.demo_story(
  p_student_email text,
  p_key uuid,
  p_title text,
  p_description text,
  p_building text,
  p_room text,
  p_steps text[]
) returns text
language plpgsql as $$
declare
  v_student uuid := pg_temp.demo_user(p_student_email);
  v_admin uuid := pg_temp.demo_user('admin@makeitright.test');
  v_staff uuid;
  v_department uuid;
  v_ticket uuid;
  v_reference integer;
  v_created boolean;
  v_version integer;
  v_status public.ticket_state;
  v_step text;
  v_action text;
begin
  -- All look-ups happen first, while the session still has its own privileges.
  for v_step in select unnest(p_steps) loop
    if split_part(v_step, '|', 1) = 'assign' then
      select d.id into strict v_department from public.departments as d
       where d.code = split_part(v_step, '|', 2);
      select p.id into v_staff from public.profiles as p
       where p.role = 'department' and p.department_id = v_department
       order by p.created_at limit 1;
    end if;
  end loop;

  perform pg_temp.demo_act_as(v_student);
  select t.id, t.reference_no, t.created into v_ticket, v_reference, v_created
    from public.create_ticket(p_title, p_description, p_building, p_room, p_key) as t;
  if not v_created then
    return format('MIR-%s already present, skipped', v_reference);
  end if;
  v_version := 1;

  for v_step in select unnest(p_steps) loop
    v_action := split_part(v_step, '|', 1);
    if v_action in ('ack', 'start', 'note', 'resolve') and v_staff is null then
      raise exception 'step "%" needs department staff for MIR-%', v_step, v_reference;
    end if;

    case v_action
      when 'assign' then
        perform pg_temp.demo_act_as(v_admin);
        select a.version into v_version from public.assign_ticket(
          v_ticket, v_department, split_part(v_step, '|', 3)::public.complaint_category,
          split_part(v_step, '|', 4)::public.ticket_priority, v_version,
          nullif(split_part(v_step, '|', 5), '')) as a;
      when 'ack' then
        perform pg_temp.demo_act_as(v_staff);
        select a.version into v_version from public.acknowledge_ticket(v_ticket, v_version) as a;
      when 'note' then
        perform pg_temp.demo_act_as(v_staff);
        perform public.add_ticket_note(v_ticket, split_part(v_step, '|', 2));
      when 'start', 'resolve' then
        perform pg_temp.demo_act_as(v_staff);
        select t.version into v_version from public.transition_ticket(
          v_ticket,
          (case v_action when 'start' then 'in_progress' else 'resolved' end)::public.ticket_state,
          v_version, nullif(split_part(v_step, '|', 2), '')) as t;
      when 'close', 'reopen' then
        perform pg_temp.demo_act_as(v_student);
        select t.version into v_version from public.transition_ticket(
          v_ticket,
          (case v_action when 'close' then 'closed' else 'reopened' end)::public.ticket_state,
          v_version, nullif(split_part(v_step, '|', 2), '')) as t;
      else
        raise exception 'unknown demo step "%"', v_step;
    end case;
  end loop;

  select c.status into v_status from public.complaints as c where c.id = v_ticket;
  return format('MIR-%s %s', v_reference, v_status);
end;
$$;

-- One transaction per ticket, so each is created at its own moment.
begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000001',
  'Ceiling lights flicker in Lab 3',
  'Three tube lights at the back of Lab 3 flicker constantly during afternoon classes. It is hard to read the board.',
  'Engineering Block', 'Lab 3',
  array['assign|electrical|electrical|medium|',
        'ack',
        'start|Starters ordered; replacing them tomorrow morning.']);
commit;

begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000002',
  'Projector in Seminar Room 2 does not turn on',
  'The ceiling projector shows no power light at all. Tried the remote and the wall switch. A presentation is planned there this week.',
  'Main Library', 'Seminar Room 2',
  array['assign|it_services|it_equipment|medium|',
        'ack',
        'start|',
        'resolve|Replaced the blown fuse in the projector power supply and tested it.',
        'close']);
commit;

begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000003',
  'Water leaking under the washroom sink',
  'Water drips steadily from the pipe under the first-floor washroom sink, and the floor stays wet and slippery.',
  'Hostel B', 'First-floor washroom',
  array['assign|plumbing|plumbing|high|Slip risk: please prioritise.']);
commit;

begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000004',
  'Wi-Fi keeps dropping in the computer lab',
  'The lab Wi-Fi disconnects every few minutes on all laptops, so online quizzes keep failing to submit.',
  'Computer Science Department', 'Lab 2',
  array['assign|it_services|it_equipment|high|',
        'ack',
        'start|Access point logs show overheating; moving it away from the window.',
        'resolve|Relocated the access point and updated its firmware. Connection stable for two hours.']);
commit;

begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000005',
  'Broken chair in Lecture Hall 4',
  'One chair in the third row has a cracked seat and wobbles badly. Someone could fall off it.',
  'Arts Block', 'Lecture Hall 4',
  array['assign|furniture|furniture|low|']);
commit;

begin;
select pg_temp.demo_story('student.one@makeitright.test', 'de000000-0000-4000-8000-000000000006',
  'Notice board glass is cracked',
  'The glass cover of the notice board near the main entrance has a long crack across it.',
  'Administration Block', 'Main entrance',
  array[]::text[]);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000007',
  'Washroom not cleaned since Monday',
  'The ground-floor washroom has not been cleaned for several days. The bins are full and there is no soap.',
  'Science Block', 'Ground floor',
  array['assign|sanitation|sanitation|medium|']);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000008',
  'Fan regulator in the reading hall is broken',
  'The regulator for the second ceiling fan only works on full speed, and the knob is loose.',
  'Main Library', 'Reading Hall',
  array['assign|electrical|electrical|low|',
        'ack',
        'start|',
        'resolve|Tightened the regulator knob.',
        'reopen|The fan still only runs on full speed.',
        'start|Replacing the regulator unit itself this time.']);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000009',
  'Printer jammed in Computer Lab 1',
  'The shared laser printer shows a paper jam error even after removing all paper from the trays.',
  'Computer Science Department', 'Lab 1',
  array['assign|it_services|it_equipment|low|',
        'ack',
        'start|',
        'resolve|Removed a torn sheet from the fuser and cleaned the rollers.',
        'close']);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000010',
  'Classroom door lock is broken',
  'The lock on the door of Room 204 does not latch, so the room cannot be locked after evening classes.',
  'Engineering Block', 'Room 204',
  array['assign|furniture|furniture|medium|']);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000011',
  'Water cooler is not cooling',
  'The drinking water cooler in the cafeteria gives warm water all day, even though it is switched on.',
  'Cafeteria', null,
  array['assign|facilities|other|medium|']);
commit;

begin;
select pg_temp.demo_story('student.two@makeitright.test', 'de000000-0000-4000-8000-000000000012',
  'Power socket sparks when a charger is plugged in',
  'The wall socket next to my desk sparks and smells of burning plastic whenever a charger is plugged in.',
  'Hostel A', 'Room 112',
  array['assign|electrical|electrical|high|Possible fire risk: inspect today.',
        'ack',
        'start|Socket isolated at the breaker; replacement fitted this afternoon.',
        'resolve|Replaced the damaged socket and checked the wiring behind it.']);
commit;
