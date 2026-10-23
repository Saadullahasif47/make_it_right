-- Schema-wide security guarantees. These assertions scan the catalog, so they also protect
-- every table and function added by future migrations (master plan §10).
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select is(
  (select array_agg(c.relname order by c.relname)
     from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null,
  'every table in public has row-level security enabled'
);

select is(
  (select array_agg(distinct table_name::text)
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  null,
  'anon holds no privilege on any public table'
);

select is(
  (select array_agg(distinct table_name::text || ':' || privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  null,
  'authenticated cannot INSERT, DELETE or TRUNCATE any public table directly'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'no public function is executable by anon'
);

-- Every RPC a signed-in user can call is listed here on purpose. Adding one is a reviewed change.
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['acknowledge_ticket', 'add_ticket_note', 'assign_ticket', 'create_ticket', 'list_complaints',
        'ticket_transition_rules', 'transition_ticket'],
  'signed-in users can execute exactly the allow-listed public functions'
);

select is(
  (select array_agg(n.nspname || '.' || p.proname)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg where cfg like 'search_path=%'
      )),
  null,
  'every SECURITY DEFINER function pins its search_path'
);

select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot use the private schema'
);

select is(
  (select array_agg(p.proname::text)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'anon cannot execute any private helper'
);

select col_is_pk('public', 'profiles', 'id', 'profiles are keyed by the auth user id');

-- Regression probes: objects created the way a future migration would create them must start
-- with no API access (default privileges actually took effect, including for PUBLIC).
create function public.zz_probe_default_privileges() returns int language sql as 'select 1';
create table public.zz_probe_default_privileges (id int);

select ok(
  not has_function_privilege('anon', 'public.zz_probe_default_privileges()', 'execute')
  and not has_function_privilege('authenticated', 'public.zz_probe_default_privileges()', 'execute'),
  'a newly created function is not executable by API roles until explicitly granted'
);

select ok(
  not has_table_privilege('anon', 'public.zz_probe_default_privileges', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.zz_probe_default_privileges', 'select, insert, update, delete'),
  'a newly created table grants nothing to API roles until explicitly granted'
);

select * from finish();
rollback;
