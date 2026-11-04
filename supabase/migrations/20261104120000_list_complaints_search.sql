-- MakeItRight: search in ticket lists (UI redesign plan §5, Stage 3).
--
--   * list_complaints gains an optional p_query. A ticket matches when its title, building or
--     room contains the text (ignoring case), or when the text is a reference such as
--     "MIR-1004", "mir1004" or "1004".
--   * Matching uses strpos, not LIKE, so % and _ in the text are ordinary characters and nothing
--     the caller types is ever interpreted as a pattern.
--   * Still SECURITY INVOKER: RLS limits the search to the tickets the caller may already see.
--     The scan runs over that already-scoped set, which is small for every role in this system.
--
-- Error codes: 22023 invalid input (unknown sort order, or a query longer than 100 characters)

drop function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority);

create function public.list_complaints(
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_statuses public.ticket_state[] default null,
  p_sort text default 'newest',
  p_cursor_priority public.ticket_priority default null,
  p_query text default null
)
returns setof public.complaints
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 51);
  v_query text := nullif(lower(btrim(p_query)), '');
  v_reference integer;
begin
  if length(v_query) > 100 then
    raise exception 'search text is too long' using errcode = '22023';
  end if;
  if v_query ~ '^(mir-?)?[0-9]{1,9}$' then
    v_reference := substring(v_query from '[0-9]+')::integer;
  end if;

  if p_sort = 'newest' then
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (
           v_query is null
           or strpos(lower(c.title), v_query) > 0
           or strpos(lower(c.building), v_query) > 0
           or strpos(lower(coalesce(c.room, '')), v_query) > 0
           or c.reference_no = v_reference
         )
         and (p_cursor_created_at is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
       order by c.created_at desc, c.id desc
       limit v_limit;
  elsif p_sort = 'oldest' then
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (
           v_query is null
           or strpos(lower(c.title), v_query) > 0
           or strpos(lower(c.building), v_query) > 0
           or strpos(lower(coalesce(c.room, '')), v_query) > 0
           or c.reference_no = v_reference
         )
         and (p_cursor_created_at is null or (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id))
       order by c.created_at asc, c.id asc
       limit v_limit;
  elsif p_sort = 'priority' then
    -- Most urgent first; within a priority, the longest-waiting ticket first.
    return query
      select c.* from public.complaints as c
       where (p_statuses is null or c.status = any (p_statuses))
         and (
           v_query is null
           or strpos(lower(c.title), v_query) > 0
           or strpos(lower(c.building), v_query) > 0
           or strpos(lower(coalesce(c.room, '')), v_query) > 0
           or c.reference_no = v_reference
         )
         and (
           p_cursor_created_at is null
           or c.priority < p_cursor_priority
           or (c.priority = p_cursor_priority and (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id))
         )
       order by c.priority desc, c.created_at asc, c.id asc
       limit v_limit;
  else
    raise exception 'unknown sort order' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority, text)
  from public, anon, authenticated;
grant execute on function public.list_complaints(integer, timestamptz, uuid, public.ticket_state[], text, public.ticket_priority, text)
  to authenticated;
