-- Identity and access rules exercised as real database roles (master plan P1.07, P1.08, §5, §10).
-- Each check impersonates a user exactly as PostgREST does: SET ROLE plus request.jwt.claims.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (fictional; rolled back at the end)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.act_as(uid uuid, extra jsonb default '{}') returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    (jsonb_build_object('sub', uid, 'role', 'authenticated') || extra)::text,
    true
  );
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

insert into public.departments (id, code, name) values
  ('d0000000-0000-4000-8000-000000000001', 'test_electrical', 'Test Electrical'),
  ('d0000000-0000-4000-8000-000000000002', 'test_plumbing', 'Test Plumbing');

-- Students try to self-promote through signup metadata; the trigger must ignore it.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000000a', 'student.a@makeitright.test', 'authenticated', 'authenticated',
   '{"display_name": "  Student\u0007 A  ", "role": "admin", "department_id": "d0000000-0000-4000-8000-000000000001"}'),
  ('b0000000-0000-4000-8000-00000000000b', 'student.b@makeitright.test', 'authenticated', 'authenticated',
   '{"display_name": "Student B"}'),
  ('c0000000-0000-4000-8000-00000000000c', 'staff@makeitright.test', 'authenticated', 'authenticated',
   '{"display_name": "Electrical Staff"}'),
  ('e0000000-0000-4000-8000-00000000000e', 'admin@makeitright.test', 'authenticated', 'authenticated',
   jsonb_build_object('display_name', repeat('x', 200)));

-- ---------------------------------------------------------------------------------------------
-- Signup trigger (BR-01 / §5: signup produces role = student)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select role::text, department_id, display_name from public.profiles
      where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ values ('student'::text, null::uuid, 'Student A'::text) $$,
  'signup creates a student profile, ignores role/department metadata, strips control characters'
);

select is(
  (select char_length(display_name) from public.profiles where id = 'e0000000-0000-4000-8000-00000000000e'),
  80,
  'an over-long display name is truncated to 80 characters'
);

-- Promotions happen only through privileged paths (here: the migration owner, as a seed would).
update public.profiles set role = 'department', department_id = 'd0000000-0000-4000-8000-000000000001'
 where id = 'c0000000-0000-4000-8000-00000000000c';
update public.profiles set role = 'admin' where id = 'e0000000-0000-4000-8000-00000000000e';

select throws_ok(
  $$ update public.profiles set role = 'department' where id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '23514',
  null,
  'a department role without a department violates the check constraint'
);

select throws_ok(
  $$ update public.profiles set department_id = 'd0000000-0000-4000-8000-000000000002'
      where id = 'e0000000-0000-4000-8000-00000000000e' $$,
  '23514',
  null,
  'an admin cannot also be attached to a department'
);

-- ---------------------------------------------------------------------------------------------
-- Anonymous visitors (BR-10: no anonymous retrieval or user enumeration)
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as_anon();

select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select * from public.departments $$, '42501', null, 'anon cannot read departments');
select throws_ok(
  $$ select private.current_app_role() $$, '42501', null, 'anon cannot call private helpers'
);

reset role;

-- ---------------------------------------------------------------------------------------------
-- Student A
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');

select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a student sees only their own profile'
);

select ok(
  (select count(*) from public.departments where code like 'test_%') = 2,
  'a signed-in user can read departments'
);

select is(private.current_app_role()::text, 'student', 'the role helper reports the caller''s own role');

select lives_ok(
  $$ update public.profiles set display_name = 'Aisha (demo)' where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'a student can rename themselves'
);

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'a student cannot promote themselves to admin'
);

select throws_ok(
  $$ update public.profiles set role = 'department', department_id = 'd0000000-0000-4000-8000-000000000001'
      where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'a student cannot join a department'
);

select throws_ok(
  $$ update public.profiles set created_at = now() - interval '1 year'
      where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'a student cannot rewrite audit timestamps'
);

-- RLS filters the other student's row out of the UPDATE, so nothing changes.
update public.profiles set display_name = 'hijacked' where id = 'b0000000-0000-4000-8000-00000000000b';

select throws_ok(
  $$ insert into public.profiles (id, role) values (gen_random_uuid(), 'admin') $$,
  '42501', null, 'a student cannot insert profiles'
);

select throws_ok(
  $$ delete from public.profiles where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'a student cannot delete profiles'
);

select throws_ok(
  $$ insert into public.departments (code, name) values ('rogue', 'Rogue') $$,
  '42501', null, 'a student cannot create departments'
);

select throws_ok(
  $$ update public.departments set is_active = false $$,
  '42501', null, 'a student cannot change departments'
);

reset role;

select is(
  (select display_name from public.profiles where id = 'b0000000-0000-4000-8000-00000000000b'),
  'Student B',
  'a student cannot rename another student'
);

select results_eq(
  $$ select role::text, display_name from public.profiles where id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ values ('student'::text, 'Aisha (demo)'::text) $$,
  'after all attempts student A is still a student, with only the permitted rename applied'
);

-- ---------------------------------------------------------------------------------------------
-- Forged JWT claims do not grant authority: roles come from the database only.
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as(
  'a0000000-0000-4000-8000-00000000000a',
  '{"app_metadata": {"role": "admin"}, "user_metadata": {"role": "admin"}, "user_role": "admin"}'
);

select is(
  (select count(*)::int from public.profiles), 1, 'admin-looking JWT claims do not widen profile access'
);
select is(private.current_app_role()::text, 'student', 'admin-looking JWT claims do not change the role');

reset role;

-- A token for a user with no profile row has no role at all.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f');
select is(private.current_app_role()::text, null::text, 'an unknown subject has no role');
select is((select count(*)::int from public.profiles), 0, 'an unknown subject sees no profiles');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Department staff
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c');

select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('c0000000-0000-4000-8000-00000000000c'::uuid) $$,
  'department staff see only their own profile'
);
select is(
  private.current_department_id(), 'd0000000-0000-4000-8000-000000000001'::uuid,
  'the department helper reports the caller''s own department'
);
select throws_ok(
  $$ update public.profiles set department_id = 'd0000000-0000-4000-8000-000000000002'
      where id = 'c0000000-0000-4000-8000-00000000000c' $$,
  '42501', null, 'department staff cannot move themselves to another department'
);

reset role;

-- ---------------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------------
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e');

select ok(
  (select count(*) from public.profiles
    where id in ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b',
                 'c0000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-00000000000e')) = 4,
  'an admin can read every profile'
);

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '42501', null, 'even an admin cannot change roles with a direct update (only a privileged operation may)'
);

reset role;

select * from finish();
rollback;
