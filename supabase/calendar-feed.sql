-- StudySync - "Add to my calendar" (routes/calendar.js). Run this once in the Supabase SQL Editor
-- (it's also at the end of schema.sql). Safe to run again.
--
-- Google / Apple / Outlook Calendar fetch the feed on their own, without logging in. Each student
-- gets a private random code (profiles.calendar_token) that's part of their link, and
-- calendar_feed() returns that one student's schedule for their code, and nothing else.
-- "Make a new link" changes the code, so an old link stops working.

alter table public.profiles add column if not exists calendar_token uuid default gen_random_uuid();
update public.profiles set calendar_token = gen_random_uuid() where calendar_token is null;
create unique index if not exists profiles_calendar_token_key on public.profiles (calendar_token);

create or replace function public.calendar_feed(feed_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'preference', p.study_preference,
    'items', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'kind', c.kind, 'category', c.category, 'name', c.name, 'location', c.location,
        'days', c.days, 'start', c.start_time, 'end', c.end_time, 'date', c.on_date))
      from public.classes c
      where c.user_id = p.user_id), '[]'::json),
    'groups', coalesce((
      select json_agg(json_build_object(
        'id', g.id, 'name', g.name, 'location', g.location, 'days', g.days, 'start', g.start_time, 'end', g.end_time))
      from public.study_groups g
      join public.group_members m on m.group_id = g.id
      where m.user_id = p.user_id), '[]'::json)
  )
  from public.profiles p
  where p.calendar_token = feed_token;
$$;

revoke all on function public.calendar_feed(uuid) from public;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;
