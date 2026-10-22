-- MakeItRight: identity and access foundation (master plan P1.02, P1.03, P1.07; §5, §9, §10).
--
-- Security model
--   * Nothing in `public` is reachable by default. Supabase normally grants anon/authenticated
--     full table privileges and EXECUTE on every new function; those defaults are revoked
--     here, so each later migration must grant exactly what it needs.
--   * Row-level security is enabled on every table; privileges and policies are both required.
--   * A signup always produces role = 'student'. Roles are never read from user metadata, and
--     ordinary users can only update their own display name (column-level grant).
--   * Helpers that policies need live in the `private` schema, which the Data API never exposes.

-- ---------------------------------------------------------------------------------------------
-- Secure defaults for everything created by this and later migrations
-- ---------------------------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE for PUBLIC is a global built-in default: a schema-scoped REVOKE cannot remove it,
-- so it is revoked globally for every function the migration role creates from now on.
alter default privileges revoke execute on functions from public;

create schema private;
revoke all on schema private from public;
-- Policies call helper functions with the caller's privileges, so callers need USAGE.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------------------------
create type public.app_role as enum ('student', 'department', 'admin');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique constraint departments_code_format check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null constraint departments_name_length check (char_length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.departments is 'Routing targets for complaints (master plan §9).';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 80),
  role public.app_role not null default 'student',
  department_id uuid references public.departments (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Department staff always belong to exactly one department; nobody else belongs to one.
  constraint profiles_department_matches_role check ((role = 'department') = (department_id is not null))
);

comment on table public.profiles is
  'One row per auth user. role/department_id change only through privileged operations.';

create index profiles_department_id_idx on public.profiles (department_id)
  where department_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Creates the profile for every new auth user. Runs as the function owner because the
-- signing-up user has no INSERT privilege on profiles. Only the display name is taken from
-- user-supplied metadata, after removing control characters; role always takes its default.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := nullif(
    btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'display_name', ''), '[[:cntrl:]]', '', 'g')),
    ''
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(requested_name, 80));

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Authorization helpers (read the caller's role from the database on every call)
-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER so that policies on profiles can consult profiles without recursing into
-- their own RLS. They only ever describe the caller (auth.uid()), never an arbitrary user.
create function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles as p where p.id = (select auth.uid());
$$;

create function private.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.department_id from public.profiles as p where p.id = (select auth.uid());
$$;

revoke all on function private.current_app_role() from public, anon, authenticated;
revoke all on function private.current_department_id() from public, anon, authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.current_department_id() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.profiles enable row level security;

revoke all on table public.departments, public.profiles from anon, authenticated;

-- Department names are not sensitive, but anonymous visitors still cannot enumerate them.
grant select on table public.departments to authenticated;

create policy departments_select_authenticated
  on public.departments for select
  to authenticated
  using (true);

grant select on table public.profiles to authenticated;
-- Column-level grant: role, department_id and timestamps are not updatable by users at all.
grant update (display_name) on table public.profiles to authenticated;

create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select private.current_app_role()) = 'admin');

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
