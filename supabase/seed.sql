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

-- Synthetic campus (Advanced Features plan v2 A0.05): 3 buildings x 2 floors x 6 rooms. Each
-- floor has rooms CR-n01, CR-n02, LAB-n03, LAB-n04, WC-n05 and OFF-n06, laid out 3 x 2 on the
-- floor plan.
insert into public.maintenance_locations
  (building_code, building_name, floor, room_code, display_name, map_x, map_y)
select b.code, b.name, f.floor, room.code, b.name || ', ' || room.code,
       167 + ((room.position - 1) % 3) * 333, 250 + ((room.position - 1) / 3) * 500
  from (values ('ENG', 'Engineering Block'), ('SCI', 'Science Block'), ('LIB', 'Library and Student Centre'))
         as b (code, name)
 cross join generate_series(1, 2) as f (floor)
 cross join lateral (
   select p as position,
          (array['CR', 'CR', 'LAB', 'LAB', 'WC', 'OFF'])[p] || '-' || f.floor || '0' || p as code
     from generate_series(1, 6) as p
 ) as room
on conflict (building_code, floor, room_code) do nothing;

-- Twelve assets. PRJ-ENG-204 and PRJ-ENG-203 are deliberately similar projectors in adjacent labs.
insert into public.asset_registry (location_id, asset_code, asset_type, label)
select l.id, a.asset_code, a.asset_type, a.label
  from (values
    ('PRJ-ENG-204', 'projector', 'Ceiling projector', 'ENG', 'LAB-204'),
    ('PRJ-ENG-203', 'projector', 'Ceiling projector', 'ENG', 'LAB-203'),
    ('SNK-ENG-105', 'sink', 'Washroom sink', 'ENG', 'WC-105'),
    ('DSK-ENG-101', 'desk_row', 'Front desk row', 'ENG', 'CR-101'),
    ('HND-ENG-205', 'hand_dryer', 'Hand dryer', 'ENG', 'WC-205'),
    ('SNK-SCI-205', 'sink', 'Washroom sink', 'SCI', 'WC-205'),
    ('PC-SCI-204', 'workstation', 'Lab workstation bench', 'SCI', 'LAB-204'),
    ('ACU-SCI-103', 'ac_unit', 'Split AC unit', 'SCI', 'LAB-103'),
    ('PRJ-SCI-104', 'projector', 'Ceiling projector', 'SCI', 'LAB-104'),
    ('ACU-LIB-101', 'ac_unit', 'Split AC unit', 'LIB', 'CR-101'),
    ('LGT-LIB-201', 'ceiling_lights', 'Reading room lights', 'LIB', 'CR-201'),
    ('WCL-LIB-105', 'water_cooler', 'Water cooler', 'LIB', 'WC-105')
  ) as a (asset_code, asset_type, label, building_code, room_code)
  join public.maintenance_locations as l
    on l.building_code = a.building_code and l.room_code = a.room_code
on conflict (asset_code) do nothing;

-- Cases backfilled before these rooms existed get their location from the report's text.
select private.locate_unknown_cases() as located_cases;

-- 60 labelled synthetic cases with their histories. Replaces earlier synthetic cases on every
-- run; cases opened by real reports are never touched.
select private.reset_synthetic_campus_history() as synthetic_cases;
