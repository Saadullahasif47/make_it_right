-- Fictional demo reference data (master plan §12). Safe to re-run.
-- Accounts are not created here: no passwords live in the repository. See
-- scripts/seed-demo-accounts.ts and docs/runbooks/demo-accounts.md.

insert into public.departments (code, name)
values
  ('electrical', 'Electrical Maintenance'),
  ('it_services', 'IT Services'),
  ('plumbing', 'Plumbing'),
  ('furniture', 'Furniture and Fixtures'),
  ('sanitation', 'Sanitation and Cleaning'),
  ('facilities', 'Facilities Office')
on conflict (code) do nothing;
