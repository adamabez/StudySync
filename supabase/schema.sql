-- StudySync database setup for Supabase.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once: it skips anything that already exists.
--
-- Every table has a user_id column, and Row Level Security (RLS) makes sure each
-- user can only see and change their own rows. user_id fills itself in with the
-- logged-in user's ID, so the app never has to send it.

-- ---------- Calendar items (classes, tasks, other) ----------
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('class', 'task', 'other')),
  category    text not null default '',          -- the "What is it?" label for Other (e.g. Work)
  name        text not null,
  location    text not null default '',          -- room, for classes
  days        text[] not null,                   -- e.g. {mon,wed,fri}
  start_time  text,                              -- "09:00", or null for async classes
  end_time    text,                              -- "10:15", or null for async classes
  created_at  timestamptz not null default now()
);

-- ---------- Virtual Notebook sources ----------
-- Pasted text and .txt/.md files are stored in text_content.
-- PDFs are stored in the "sources" Storage bucket at <user_id>/<source id>.pdf.
create table if not exists public.sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null,
  course        text not null default '',
  type          text not null check (type in ('text', 'pdf')),
  size          integer not null,                -- characters for text, bytes for PDFs
  text_content  text,                            -- only for type = 'text'
  added_at      timestamptz not null default now()
);

-- ---------- Virtual Notebook saved chats ----------
create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  messages    jsonb not null default '[]'::jsonb, -- [{ role, label, question } | { role, answer, citations }]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Canvas connection (for Gurkirat's Canvas integration) ----------
create table if not exists public.canvas_connections (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  canvas_url    text not null,                   -- e.g. https://<school>.instructure.com
  access_token  text not null,                   -- only ever read by the server
  created_at    timestamptz not null default now()
);

-- ---------- Feedback and bug reports (from the dashboard's "Send feedback" link) ----------
-- Users can add reports but not read them. Read them in Table Editor → feedback.
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('bug', 'feedback', 'idea')),
  message     text not null,
  email       text not null default '',          -- so the team can reply
  page        text not null default '',          -- which page they were on
  user_agent  text not null default '',          -- browser + device, helps with bugs
  created_at  timestamptz not null default now()
);

-- ---------- Profile: one row per user (has the user finished the first-login setup?) ----------
create table if not exists public.profiles (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  onboarded_at      timestamptz,                 -- null until they finish (or skip) the schedule screen
  study_preference  text check (study_preference in ('alone', 'group')),
  weekly_study_hours integer check (weekly_study_hours between 1 and 40),  -- study goal; null = 6
  study_notes       text check (char_length(study_notes) <= 300),  -- "I'm a night owl", for the AI planner
  study_plan        jsonb,                       -- last AI study plan (saved so the AI doesn't rerun every visit)
  study_plan_key    text,                        -- fingerprint of the schedule/goal/notes that plan was made for
  display_name      text check (char_length(display_name) between 1 and 40),  -- what study group members see (never the email)
  created_at        timestamptz not null default now()
);
alter table public.profiles add column if not exists display_name text check (char_length(display_name) between 1 and 40);
-- (for projects that made the profiles table before study_preference existed)
alter table public.profiles add column if not exists study_preference text check (study_preference in ('alone', 'group'));
alter table public.profiles add column if not exists weekly_study_hours integer check (weekly_study_hours between 1 and 40);
alter table public.profiles add column if not exists study_notes text check (char_length(study_notes) <= 300);
alter table public.profiles add column if not exists study_plan jsonb;
alter table public.profiles add column if not exists study_plan_key text;

-- ---------- Study groups ----------
-- Students who'd rather study in a group are matched automatically (see
-- match_study_group below): each group meets once a week at a time every member
-- is free. Only members can see a group and who's in it.
create table if not exists public.study_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  course      text not null default '',
  location    text not null default '',
  days        text[] not null,                   -- e.g. {tue,thu}
  start_time  text not null,                     -- "18:00"
  end_time    text not null,                     -- "19:30"
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id   uuid not null references public.study_groups (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
-- Members used to see each other's emails through this column. Names only now
-- (group_member_names below), so emails never leave the database.
alter table public.group_members drop column if exists email;

-- Notes shared inside a study group: every member can read them, add their own,
-- and delete their own.
create table if not exists public.group_notes (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.study_groups (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 20000),
  created_at  timestamptz not null default now()
);

-- Async classes have no set time (for projects created before this was allowed)
alter table public.classes alter column start_time drop not null;
alter table public.classes alter column end_time drop not null;

-- Speed up "my rows" lookups
create index if not exists classes_user_id_idx on public.classes (user_id);
create index if not exists sources_user_id_idx on public.sources (user_id);
create index if not exists chats_user_id_updated_idx on public.chats (user_id, updated_at desc);
create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists group_notes_group_id_idx on public.group_notes (group_id, created_at desc);

-- ---------- Row Level Security: each user only sees their own rows ----------
alter table public.classes            enable row level security;
alter table public.sources            enable row level security;
alter table public.chats              enable row level security;
alter table public.canvas_connections enable row level security;
alter table public.feedback           enable row level security;
alter table public.profiles           enable row level security;
alter table public.study_groups       enable row level security;
alter table public.group_members      enable row level security;
alter table public.group_notes        enable row level security;

drop policy if exists "Own profile" on public.profiles;
create policy "Own profile" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Study groups: who can see what ----------
-- "Am I in this group?" A policy on group_members can't look at group_members itself
-- (Postgres would loop forever), so this function does the check with RLS turned off.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid())
  );
$$;

-- Read only: members see their group and fellow members. There are no insert/update/
-- delete policies; the only way into a group is match_study_group() below.
drop policy if exists "Everyone sees groups" on public.study_groups;
drop policy if exists "Members see their groups" on public.study_groups;
create policy "Members see their groups" on public.study_groups
  for select to authenticated
  using (public.is_group_member(id));

drop policy if exists "Members see fellow members" on public.group_members;
create policy "Members see fellow members" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

-- Group notes: members read all of the group's notes; you can only add to a group
-- you're in, and only delete your own.
drop policy if exists "Members read group notes" on public.group_notes;
create policy "Members read group notes" on public.group_notes
  for select to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Members add group notes" on public.group_notes;
create policy "Members add group notes" on public.group_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));

drop policy if exists "Delete own group notes" on public.group_notes;
create policy "Delete own group notes" on public.group_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Earlier versions let students create/join groups by hand. Matching is automatic now.
drop function if exists public.study_group_sizes();
drop function if exists public.create_study_group(text, text);
drop function if exists public.create_study_group(text, text, text, text[], text, text);
drop function if exists public.join_study_group(text);
drop function if exists public.join_study_group(uuid);
drop function if exists public.leave_study_group(uuid);

-- ---------- Automatic study group matching ----------
-- Is this user free on these days between p_start and p_end? (Async classes never clash.)
-- Only used inside match_study_group, so students can't use it to peek at each other's schedules.
create or replace function public.user_is_free(p_user uuid, p_days text[], p_start text, p_end text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.classes c
    where c.user_id = p_user
      and c.start_time is not null
      and c.days && p_days
      and c.start_time < p_end
      and p_start < c.end_time
  );
$$;

-- Name for a new group: the course, then the first free letter, e.g. "CSC 20 | Group A",
-- "CSC 20 | Group B". Groups without a shared class are "General | Group A".
create or replace function public.next_group_name(p_course text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  label     text := case when btrim(coalesce(p_course, '')) = '' then 'General' else upper(btrim(p_course)) end;
  candidate text;
begin
  for i in 0..25 loop
    candidate := label || ' | Group ' || chr(65 + i);
    if not exists (select 1 from public.study_groups where name = candidate) then
      return candidate;
    end if;
  end loop;
  -- More than 26 groups for one course: number them instead
  return label || ' | Group ' || (select count(*) + 1 from public.study_groups where name like label || ' | Group %');
end;
$$;

-- Put the logged-in student in a study group if they want one. Runs whenever they open
-- the landing page, finish setup, or change their schedule. Returns their group's ID,
-- or null if nobody's schedule fits yet (they'll be matched when someone's does).
--
-- How it decides:
--   0. Not looking for a group (prefers studying alone)? Leave any group, stop.
--   1. In a group that now clashes with your schedule? Leave it.
--   2. Already in a group with other people? Done. The only one left in your group
--      (everyone else left)? Move to another group that fits if there is one, so lone
--      one-person groups don't pile up; your notes come with you.
--   3. Join a group with room (fewer than 4) that meets when you're free. A group for
--      a class only takes students in that class. Your-class groups first, then the fullest.
--   4. Find another waiting student with a reasonable free 90-minute slot in common, and
--      start a group for the two of you. Reasonable = weekdays between 9 AM and 9 PM,
--      weekends between 10 AM and 6 PM. Students in the same class first; afternoons and
--      weekdays before mornings and weekends. At most 26 groups per class (Group A–Z):
--      after that, students join existing groups instead of starting new ones.
--   5. Nobody fits: wait. No group is made just to have one.
create or replace function public.match_study_group()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  max_size    constant int := 4;
  max_groups  constant int := 26;  -- per class: Group A to Group Z
  g           record;
  gid         uuid;
  alone_gid   uuid;                -- your group, if you're the only one left in it
  partner     record;
begin
  if uid is null then raise exception 'Not logged in'; end if;
  -- One match at a time, so two students loading the page together don't both start a group
  perform pg_advisory_xact_lock(hashtext('studysync_group_matching'));

  -- 0 + 1. Leave groups you no longer want or that clash with your schedule
  for g in
    select sg.id, sg.days, sg.start_time, sg.end_time
    from public.study_groups sg join public.group_members m on m.group_id = sg.id
    where m.user_id = uid
  loop
    if not exists (select 1 from public.profiles where user_id = uid and study_preference = 'group')
       or not public.user_is_free(uid, g.days, g.start_time, g.end_time) then
      delete from public.group_members where group_id = g.id and user_id = uid;
      delete from public.study_groups sg
      where sg.id = g.id and not exists (select 1 from public.group_members m where m.group_id = sg.id);
    end if;
  end loop;

  if not exists (select 1 from public.profiles where user_id = uid and study_preference = 'group') then
    return null;
  end if;

  -- 2. Already in a group (with other people: done; on your own: try to move, below)
  select m.group_id into gid from public.group_members m where m.user_id = uid limit 1;
  if gid is not null then
    if (select count(*) from public.group_members m where m.group_id = gid) > 1 then
      return gid;
    end if;
    alone_gid := gid;
    gid := null;
  end if;

  -- 3. Join an existing group that fits (not the one you're alone in)
  select sg.id into gid
  from public.study_groups sg
  cross join lateral (select count(*) as n from public.group_members m where m.group_id = sg.id) size
  cross join lateral (
    select exists (
      select 1 from public.classes c
      where c.user_id = uid and c.kind = 'class' and lower(btrim(c.name)) = lower(btrim(sg.course))
    ) as mine
  ) shares
  where size.n < max_size
    and sg.id is distinct from alone_gid
    and (sg.course = '' or shares.mine)
    and public.user_is_free(uid, sg.days, sg.start_time, sg.end_time)
  order by shares.mine desc, size.n desc, sg.created_at
  limit 1;

  if gid is not null then
    if alone_gid is not null then
      -- Moving out of a group you were alone in: bring your notes, then remove the empty group
      update public.group_notes set group_id = gid where group_id = alone_gid;
      delete from public.group_members where group_id = alone_gid and user_id = uid;
      delete from public.study_groups where id = alone_gid;
    end if;
    insert into public.group_members (group_id, user_id) values (gid, uid);
    return gid;
  end if;

  -- Alone in your group and nothing better fits: stay put (new students who fit will join you)
  if alone_gid is not null then return alone_gid; end if;

  -- 4. Start a new group with another waiting student, at a reasonable time:
  --    weekdays 9 AM – 9 PM, weekends 10 AM – 6 PM (90-minute sessions)
  with slots as (
    select d.day_key, d.ord,
           to_char(t, 'HH24:MI') as start_t,
           to_char(t + interval '90 minutes', 'HH24:MI') as end_t
    from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) with ordinality as d(day_key, ord)
    cross join generate_series(timestamp '2000-01-01 09:00', timestamp '2000-01-01 19:30', interval '30 minutes') as t
    where (d.ord <= 5) or (t >= timestamp '2000-01-01 10:00' and t <= timestamp '2000-01-01 16:30')
  )
  select p.user_id as other_id, s.day_key, s.start_t, s.end_t, shared.course
  into partner
  from public.profiles p
  left join lateral (
    select min(c1.name) as course
    from public.classes c1
    join public.classes c2 on lower(btrim(c1.name)) = lower(btrim(c2.name))
    where c1.user_id = uid and c2.user_id = p.user_id and c1.kind = 'class' and c2.kind = 'class'
  ) shared on true
  cross join slots s
  where p.user_id <> uid
    and p.study_preference = 'group'
    and p.onboarded_at is not null
    and not exists (select 1 from public.group_members m where m.user_id = p.user_id)
    -- this class (or "General") doesn't already have Group A–Z
    and (select count(*) from public.study_groups sg
         where lower(btrim(sg.course)) = lower(btrim(coalesce(shared.course, '')))) < max_groups
    and public.user_is_free(uid, array[s.day_key], s.start_t, s.end_t)
    and public.user_is_free(p.user_id, array[s.day_key], s.start_t, s.end_t)
  order by (shared.course is not null) desc,
           case when s.start_t between '15:00' and '19:00' then 0 when s.start_t >= '12:00' then 1 else 2 end,
           s.ord > 5,
           s.ord,
           s.start_t,
           p.onboarded_at
  limit 1;

  if not found then return null; end if; -- 5. nobody fits yet

  insert into public.study_groups (name, course, days, start_time, end_time, created_by)
  values (
    public.next_group_name(partner.course),
    coalesce(btrim(partner.course), ''),
    array[partner.day_key], partner.start_t, partner.end_t, uid
  )
  returning id into gid;

  insert into public.group_members (group_id, user_id) values (gid, uid), (gid, partner.other_id);

  return gid;
end;
$$;

-- The names of a group's members, for members of that group only. Profiles are private
-- (each student only reads their own), so this hands out just the name: the one set in
-- StudySync, else the one given at sign-up, else "Classmate". Never the email.
drop function if exists public.group_member_names(uuid);
create function public.group_member_names(gid uuid)
returns table (user_id uuid, name text, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id,
         coalesce(nullif(btrim(p.display_name), ''),
                  nullif(left(btrim(u.raw_user_meta_data ->> 'name'), 40), ''),
                  'Classmate'),
         m.joined_at
  from public.group_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.group_id = gid and public.is_group_member(gid)
  order by m.joined_at;
$$;
revoke execute on function public.group_member_names(uuid) from public, anon;
grant execute on function public.group_member_names(uuid) to authenticated;

-- Rename groups made before the "CSC 20 | Group A" names, oldest first
do $$
declare g record;
begin
  for g in
    select id, course from public.study_groups
    where name = 'Study group' or name like '% study group'
    order by created_at
  loop
    update public.study_groups set name = public.next_group_name(g.course) where id = g.id;
  end loop;
end;
$$;

-- Students can call match_study_group (for themselves) and is_group_member (used by the policies).
-- user_is_free and next_group_name are internal only.
revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.user_is_free(uuid, text[], text, text) from public, anon, authenticated;
revoke execute on function public.next_group_name(text) from public, anon, authenticated;
revoke execute on function public.match_study_group() from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.match_study_group() to authenticated;

-- Insert only: no select/update/delete policy, so users can't read anyone's reports (even their own)
drop policy if exists "Send feedback" on public.feedback;
create policy "Send feedback" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Own classes" on public.classes;
create policy "Own classes" on public.classes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Own sources" on public.sources;
create policy "Own sources" on public.sources
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Own chats" on public.chats;
create policy "Own chats" on public.chats
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Own Canvas connection" on public.canvas_connections;
create policy "Own Canvas connection" on public.canvas_connections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Storage for PDF sources ----------
-- A private bucket; each user's files live in a folder named after their user ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 10485760, array['application/pdf'])  -- 10 MB, PDFs only
on conflict (id) do nothing;

drop policy if exists "Own source files: read" on storage.objects;
create policy "Own source files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own source files: upload" on storage.objects;
create policy "Own source files: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own source files: delete" on storage.objects;
create policy "Own source files: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
