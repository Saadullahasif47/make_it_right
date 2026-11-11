-- Forgiving building and room matching (F2 duplicate detection, F5 locations).
--
-- Students type places in many ways: "lab 103", "LAB-103", "Lab103", "Room LAB 103"; "science",
-- "Science Block", "SCI". Until now a room matched only when the text was identical apart from
-- case and outer spaces, so the same room written two ways was treated as two rooms. Worse, when
-- one report had a known room and the other did not, worker_duplicate_features answered NULL
-- instead of false for "same room", which the worker rightly refuses, so the whole duplicate job
-- failed (HANDLER_FAILED).
--
-- This migration:
--   1. adds two normalisers: a place is compared on its letters and digits only, lower case, and a
--      room also drops a leading "room" or "rm";
--   2. treats two building names as the same when, normalised, they are equal or one starts with
--      the other (at least 3 characters), so "science" matches "Science Block";
--   3. uses both in match_location (ambiguous matches still stay unknown) and in
--      worker_duplicate_features, whose flags can no longer be NULL;
--   4. places reports that the stricter matching left as "location unknown".
--
-- Additive: function bodies are replaced with the same signatures; no table changes.

create function private.normalize_place(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]', '', 'g');
$$;

create function private.normalize_room(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when n ~ '^(room|rm).' then regexp_replace(n, '^(room|rm)', '')
           else n
         end
    from (select private.normalize_place(p_text) as n) as s;
$$;

-- Two building names name the same building when, normalised, they are equal or one is the start
-- of the other ("science" and "Science Block", "eng" and "Engineering Block"). Both must have at
-- least 3 characters, so a stray letter never matches a building.
create function private.same_building_name(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(a) >= 3 and length(b) >= 3
         and (a = b or starts_with(a, b) or starts_with(b, a))
    from (select private.normalize_place(p_a) as a, private.normalize_place(p_b) as b) as s;
$$;

revoke all on function private.normalize_place(text) from public, anon, authenticated;
revoke all on function private.normalize_room(text) from public, anon, authenticated;
revoke all on function private.same_building_name(text, text) from public, anon, authenticated;

-- Maps a report's free-text building and room to a known location, now forgiving about case,
-- spaces, hyphens and a "Room" prefix. Anything unmatched or ambiguous is still UNKNOWN (null):
-- a wrong room is worse than an unknown one on the heatmap.
create or replace function private.match_location(p_building text, p_room text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(l.id))[1] end
    from public.maintenance_locations as l
   where l.is_active
     and private.normalize_room(p_room) <> ''
     and (private.same_building_name(p_building, l.building_code)
          or private.same_building_name(p_building, l.building_name))
     and private.normalize_room(l.room_code) = private.normalize_room(p_room);
$$;

-- Candidate cases for a report, with the features the ranker needs (F2.03). Same scope as before:
-- open, unmerged cases opened in the last 30 days, in the same building, with at least one report
-- embedded by the same model. Every flag is now true or false, never NULL.
create or replace function public.worker_duplicate_features(p_complaint_id uuid, p_model text, p_limit integer default 10)
returns table (
  case_id uuid,
  case_reference integer,
  similarity real,
  same_building boolean,
  same_room boolean,
  category_match boolean,
  same_asset boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select c.id, c.category, c.building, private.normalize_room(c.room) as room,
           e.embedding, cr.case_id as own_case, mc.location_id, mc.asset_id,
           l.building_code, l.building_name
      from public.complaints as c
      join public.complaint_embeddings as e on e.complaint_id = c.id and e.model = p_model
      join public.case_reports as cr on cr.complaint_id = c.id
      join public.maintenance_cases as mc on mc.id = cr.case_id
      left join public.maintenance_locations as l on l.id = mc.location_id
     where c.id = p_complaint_id
  ),
  scored as (
    select mc.id as case_id,
           mc.reference_no,
           max(1 - (e.embedding operator(extensions.<=>) me.embedding))::real as similarity,
           -- Same building: the reports' building text, or the known locations' building.
           coalesce(bool_or(private.same_building_name(c.building, me.building)), false)
             or coalesce(me.building_code is not null and max(l.building_code) = me.building_code, false)
             or coalesce(private.same_building_name(me.building, max(l.building_code))
                         or private.same_building_name(me.building, max(l.building_name)), false)
             as same_building,
           -- Same room: the same known location, the same room text in the same building, or this
           -- report's room text naming the other case's known room.
           coalesce(me.location_id is not null and mc.location_id = me.location_id, false)
             or coalesce(bool_or(me.room <> ''
                                 and private.same_building_name(c.building, me.building)
                                 and private.normalize_room(c.room) = me.room), false)
             or coalesce(me.room <> ''
                         and private.normalize_room(max(l.room_code)) = me.room
                         and (private.same_building_name(me.building, max(l.building_code))
                              or private.same_building_name(me.building, max(l.building_name))), false)
             as same_room,
           -- Compatible: the same category, or one not classified yet (routing off or pending).
           -- An unknown category is no evidence of a different problem.
           (me.category = 'unclassified' or mc.category = 'unclassified' or mc.category = me.category) as category_match,
           coalesce(me.asset_id is not null and mc.asset_id = me.asset_id, false) as same_asset
      from me
      join public.maintenance_cases as mc
        on mc.id <> me.own_case
       and mc.status not in ('closed', 'merged')
       and mc.opened_at > now() - interval '30 days'
      join public.case_reports as cr on cr.case_id = mc.id
      join public.complaints as c on c.id = cr.complaint_id
      join public.complaint_embeddings as e on e.complaint_id = c.id and e.model = p_model
      left join public.maintenance_locations as l on l.id = mc.location_id
     group by mc.id, mc.reference_no, mc.location_id, mc.category, mc.asset_id,
              me.building, me.building_code, me.location_id, me.room, me.category, me.asset_id
  )
  select s.case_id, s.reference_no, s.similarity, s.same_building, s.same_room, s.category_match, s.same_asset
    from scored as s
   where s.same_building
   order by s.similarity desc
   limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

-- Reports the stricter matching left as "location unknown" now get their room, with an event.
select private.locate_unknown_cases();
