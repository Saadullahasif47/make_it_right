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

-- Default routing: which department handles each category (plan §9, routing_rules).
insert into public.routing_rules (category, department_id)
select rule.category::public.complaint_category, d.id
  from (values
    ('electrical', 'electrical'),
    ('it_equipment', 'it_services'),
    ('plumbing', 'plumbing'),
    ('furniture', 'furniture'),
    ('sanitation', 'sanitation'),
    ('other', 'facilities')
  ) as rule (category, department_code)
  join public.departments as d on d.code = rule.department_code
on conflict (category) do nothing;
