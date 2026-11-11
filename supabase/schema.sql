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

-- ---------- Course catalog (Sac State) ----------
-- Every course at the school, so students pick their classes from a list and students in
-- the same class always match. Filled by supabase/courses.sql (made by
-- scripts/import-courses.js from the public catalog). Cross-listed courses (EEE 64 and
-- CPE 64) share a match_key, so their students are grouped together.
create table if not exists public.courses (
  code       text primary key,                   -- "CSC 20"
  subject    text not null,                      -- "CSC"
  number     text not null,                      -- "20"
  title      text not null,                      -- "Programming Concepts and Methodology II"
  units      text not null default '',
  match_key  text not null                       -- same for cross-listed courses
);
create index if not exists courses_match_key_idx on public.courses (match_key);

-- Which catalog course a class is (null for classes not in the catalog, and for work etc.)
alter table public.classes add column if not exists course_code text references public.courses (code) on update cascade on delete set null;
-- Which section ("02"), when picked from Sac State's class schedule
alter table public.classes add column if not exists section text check (char_length(section) <= 10);

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
-- Visitors without an account (login page, the demo) can send feedback too: no user_id
alter table public.feedback alter column user_id drop not null;

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
alter table public.courses            enable row level security;

-- The catalog is public information: any logged-in student can read it, nobody can change it
-- from the app (it's loaded with supabase/courses.sql in the SQL Editor).
drop policy if exists "Everyone reads courses" on public.courses;
create policy "Everyone reads courses" on public.courses
  for select to authenticated
  using (true);

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

-- ---------- Which class is which ----------
-- A class's "course key" decides who it's grouped with. Picked from the catalog → the
-- course's match_key (so EEE 64 and CPE 64 match). Typed by hand → cleaned up and looked up
-- in the catalog anyway: spacing, capitals and section numbers are ignored, so
-- "csc20", "CSC 20-01" and "CSC 20" are all CSC 20. Not in the catalog at all → the cleaned
-- name, so students who type the same thing still match.

-- "csc20 - 01" → "CSC 20";  "EEE / CPE 64-02, 03" → "EEE 64";  "Biology 101" → "BIOLOGY 101"
create or replace function public.normalize_course(p_name text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  s text := upper(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  m text[];
begin
  m := regexp_match(s, '^([A-Z&]{1,8})(?: ?/ ?[A-Z&]{1,8})* ?([0-9]{1,3}[A-Z]{0,3})(?: ?-.*| SEC.*| \(.*)?$');
  if m is not null then return m[1] || ' ' || m[2]; end if;
  return s;
end;
$$;

create or replace function public.course_key(p_course_code text, p_name text)
returns text
language sql stable set search_path = ''
as $$
  select coalesce(
    (select match_key from public.courses where code = p_course_code),
    (select match_key from public.courses where code = public.normalize_course(p_name)),
    public.normalize_course(p_name)
  );
$$;

-- How a course key is shown: "CSC 20", or "CPE 64 / EEE 64" for cross-listed courses
create or replace function public.course_label(p_key text)
returns text
language sql stable set search_path = ''
as $$
  select coalesce(
    (select string_agg(code, ' / ' order by code) from public.courses where match_key = p_key),
    p_key
  );
$$;

-- Do this student's study groups (other than p_except) leave this time free?
-- Only used inside match_study_group.
create or replace function public.user_groups_free(p_user uuid, p_days text[], p_start text, p_end text, p_except uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.group_members m
    join public.study_groups sg on sg.id = m.group_id
    where m.user_id = p_user
      and sg.id is distinct from p_except
      and sg.days && p_days
      and sg.start_time < p_end
      and p_start < sg.end_time
  );
$$;

-- Put the logged-in student in a study group for EACH of their classes, if they want groups.
-- Runs whenever they open the landing page, finish setup, or change their schedule.
-- Returns how many groups they're in afterwards.
--
-- How it decides:
--   0. Not looking for groups (prefers studying alone)? Leave every group, stop.
--   1. Leave groups that clash with your schedule now, or for a class you dropped.
--   Then for each of your classes:
--   2. Already in a group for it with other people? Done. The only one left in it? Move
--      to another group for that class if one fits (your notes come with you).
--   3. Join a group for that class with room (fewer than 4) that meets when you're free
--      and doesn't clash with your other groups. Fullest first.
--   4. Find another student in that class who wants a group and isn't in one for it, with
--      a reasonable free 90-minute slot in common (weekdays 9 AM – 9 PM, weekends
--      10 AM – 6 PM) that clashes with neither student's classes nor other groups, and start
--      a group for the two of you. Afternoons and weekdays first. At most 26 groups per
--      class (Group A–Z): after that, students join existing groups instead.
--   5. Nobody fits yet: wait. You'll be matched when someone's schedule fits.
drop function if exists public.match_study_group();
create function public.match_study_group()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  max_size    constant int := 4;
  max_groups  constant int := 26;  -- per class: Group A to Group Z
  wants       boolean;
  g           record;
  k           record;
  gid         uuid;
  alone_gid   uuid;                -- your group for this class, if you're the only one left in it
  partner     record;
  in_groups   int := 0;
begin
  if uid is null then raise exception 'Not logged in'; end if;
  -- One match at a time, so two students loading the page together don't both start a group
  perform pg_advisory_xact_lock(hashtext('studysync_group_matching'));

  wants := exists (select 1 from public.profiles where user_id = uid and study_preference = 'group');

  -- 0 + 1. Leave groups you no longer want, that clash with your schedule, or whose class you dropped
  for g in
    select sg.id, sg.course, sg.days, sg.start_time, sg.end_time
    from public.study_groups sg join public.group_members m on m.group_id = sg.id
    where m.user_id = uid
  loop
    if not wants
       or not public.user_is_free(uid, g.days, g.start_time, g.end_time)
       or (g.course <> '' and not exists (
             select 1 from public.classes c
             where c.user_id = uid and c.kind = 'class' and public.course_key(c.course_code, c.name) = g.course))
    then
      delete from public.group_members where group_id = g.id and user_id = uid;
      delete from public.study_groups sg
      where sg.id = g.id and not exists (select 1 from public.group_members m where m.group_id = sg.id);
    end if;
  end loop;

  if not wants then return 0; end if;

  -- Groups from before one-group-per-class with no class ("General") still count, but no new ones are made
  in_groups := (select count(*) from public.group_members m join public.study_groups sg on sg.id = m.group_id
                where m.user_id = uid and sg.course = '');

  for k in
    select distinct public.course_key(c.course_code, c.name) as key
    from public.classes c
    where c.user_id = uid and c.kind = 'class' and btrim(c.name) <> ''
  loop
    gid := null;
    alone_gid := null;

    -- 2. Already in a group for this class?
    select m.group_id into gid
    from public.group_members m join public.study_groups sg on sg.id = m.group_id
    where m.user_id = uid and sg.course = k.key
    limit 1;
    if gid is not null then
      if (select count(*) from public.group_members m where m.group_id = gid) > 1 then
        in_groups := in_groups + 1;
        continue;
      end if;
      alone_gid := gid;
      gid := null;
    end if;

    -- 3. Join an existing group for this class that fits
    select sg.id into gid
    from public.study_groups sg
    cross join lateral (select count(*) as n from public.group_members m where m.group_id = sg.id) size
    where sg.course = k.key
      and size.n < max_size
      and sg.id is distinct from alone_gid
      and public.user_is_free(uid, sg.days, sg.start_time, sg.end_time)
      and public.user_groups_free(uid, sg.days, sg.start_time, sg.end_time, alone_gid)
    order by size.n desc, sg.created_at
    limit 1;

    if gid is not null then
      if alone_gid is not null then
        -- Moving out of a group you were alone in: bring your notes and suggested spots, then remove the empty group
        update public.group_notes set group_id = gid where group_id = alone_gid;
        update public.group_spots set group_id = gid where group_id = alone_gid;
        delete from public.group_members where group_id = alone_gid and user_id = uid;
        delete from public.study_groups where id = alone_gid;
      end if;
      insert into public.group_members (group_id, user_id) values (gid, uid);
      in_groups := in_groups + 1;
      continue;
    end if;

    -- Alone in your group and nothing better fits: stay put (new students who fit will join you)
    if alone_gid is not null then
      in_groups := in_groups + 1;
      continue;
    end if;

    -- This class already has Group A–Z: only join existing groups
    if (select count(*) from public.study_groups sg where sg.course = k.key) >= max_groups then
      continue;
    end if;

    -- 4. Start a new group with another student in this class, at a reasonable time
    with slots as (
      select d.day_key, d.ord,
             to_char(t, 'HH24:MI') as start_t,
             to_char(t + interval '90 minutes', 'HH24:MI') as end_t
      from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) with ordinality as d(day_key, ord)
      cross join generate_series(timestamp '2000-01-01 09:00', timestamp '2000-01-01 19:30', interval '30 minutes') as t
      where (d.ord <= 5) or (t >= timestamp '2000-01-01 10:00' and t <= timestamp '2000-01-01 16:30')
    )
    select p.user_id as other_id, s.day_key, s.start_t, s.end_t
    into partner
    from public.profiles p
    cross join slots s
    where p.user_id <> uid
      and p.study_preference = 'group'
      and p.onboarded_at is not null
      and exists (
        select 1 from public.classes c2
        where c2.user_id = p.user_id and c2.kind = 'class' and public.course_key(c2.course_code, c2.name) = k.key)
      and not exists (
        select 1 from public.group_members m join public.study_groups sg on sg.id = m.group_id
        where m.user_id = p.user_id and sg.course = k.key)
      and public.user_is_free(uid, array[s.day_key], s.start_t, s.end_t)
      and public.user_groups_free(uid, array[s.day_key], s.start_t, s.end_t, null)
      and public.user_is_free(p.user_id, array[s.day_key], s.start_t, s.end_t)
      and public.user_groups_free(p.user_id, array[s.day_key], s.start_t, s.end_t, null)
    order by case when s.start_t between '15:00' and '19:00' then 0 when s.start_t >= '12:00' then 1 else 2 end,
             s.ord > 5,
             s.ord,
             s.start_t,
             p.onboarded_at
    limit 1;

    if not found then continue; end if; -- 5. nobody fits yet for this class

    insert into public.study_groups (name, course, days, start_time, end_time, created_by)
    values (public.next_group_name(public.course_label(k.key)), k.key, array[partner.day_key], partner.start_t, partner.end_t, uid)
    returning id into gid;

    insert into public.group_members (group_id, user_id) values (gid, uid), (gid, partner.other_id);
    in_groups := in_groups + 1;
  end loop;

  return in_groups;
end;
$$;

-- For the landing page: each of your classes, and whether you're in a group for it yet
-- (runs as you, so it only sees your classes and your groups)
create or replace function public.my_class_groups()
returns table (course_key text, label text, has_group boolean)
language sql stable set search_path = ''
as $$
  select k.key, public.course_label(k.key),
         exists (select 1 from public.study_groups sg where sg.course = k.key) -- RLS: only groups you're in
  from (
    select distinct public.course_key(c.course_code, c.name) as key
    from public.classes c
    where c.user_id = (select auth.uid()) and c.kind = 'class' and btrim(c.name) <> ''
  ) k
  order by 2;
$$;

-- Classes added before the catalog: link them to their catalog course, and use course keys
-- for existing groups. (Run again after loading supabase/courses.sql; courses.sql does this too.)
update public.classes c
set course_code = co.code
from public.courses co
where c.kind = 'class' and c.course_code is null and co.code = public.normalize_course(c.name);

update public.study_groups
set course = public.course_key(null, course)
where course <> '' and course is distinct from public.course_key(null, course);

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

-- ---------- Delete my account ----------
-- The app's key can't delete logins, so this runs with the owner's rights, and only ever
-- for the logged-in student. Their classes, notes, chats, profile and so on go with them
-- (every table cascades from auth.users). Study groups they started are handed to another
-- member first, so classmates keep their group and its notes. (PDF files in Storage are
-- removed by the server before this runs: see server.js /api/account/delete.)
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not logged in'; end if;

  update public.study_groups sg
  set created_by = (
    select m.user_id from public.group_members m
    where m.group_id = sg.id and m.user_id <> uid
    order by m.joined_at limit 1)
  where sg.created_by = uid
    and exists (select 1 from public.group_members m where m.group_id = sg.id and m.user_id <> uid);

  delete from public.study_groups where created_by = uid; -- groups only they were in
  delete from auth.users where id = uid;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

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

-- Students can call match_study_group (for themselves), my_class_groups, is_group_member (used
-- by the policies) and the course helpers. user_is_free, user_groups_free and next_group_name
-- are internal only, so nobody can peek at other students' schedules or groups.
revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.user_is_free(uuid, text[], text, text) from public, anon, authenticated;
revoke execute on function public.user_groups_free(uuid, text[], text, text, uuid) from public, anon, authenticated;
revoke execute on function public.next_group_name(text) from public, anon, authenticated;
revoke execute on function public.match_study_group() from public, anon;
revoke execute on function public.my_class_groups() from public, anon;
revoke execute on function public.normalize_course(text) from public, anon;
revoke execute on function public.course_key(text, text) from public, anon;
revoke execute on function public.course_label(text) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.match_study_group() to authenticated;
grant execute on function public.my_class_groups() to authenticated;
grant execute on function public.normalize_course(text) to authenticated;
grant execute on function public.course_key(text, text) to authenticated;
grant execute on function public.course_label(text) to authenticated;

-- Insert only: no select/update/delete policy, so users can't read anyone's reports (even their own)
drop policy if exists "Send feedback" on public.feedback;
create policy "Send feedback" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Feedback from visitors without an account (login page, the demo). Still insert only.
-- The server limits how often one visitor can send it (server.js).
drop policy if exists "Send feedback without an account" on public.feedback;
create policy "Send feedback without an account" on public.feedback
  for insert to anon
  with check (user_id is null);
grant insert on public.feedback to anon;

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

-- ---------- Canvas Calendar Feed (for schools like Sac State that block student access tokens) ----------
-- A student can connect with their Canvas Calendar Feed link instead of a token. The feed has
-- due dates but not submissions, so students tick off finished work (homework_done).
alter table public.canvas_connections add column if not exists feed_url text;   -- server-only, like the token
alter table public.canvas_connections alter column access_token drop not null;  -- null when using the feed

create table if not exists public.homework_done (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  assignment_id  text not null,                    -- Canvas assignment ID from the feed
  done_at        timestamptz not null default now(),
  primary key (user_id, assignment_id)
);
alter table public.homework_done enable row level security;

drop policy if exists "Own homework check-offs" on public.homework_done;
create policy "Own homework check-offs" on public.homework_done
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Meetups and Discord ----------
-- StudySync is where a group decides where to meet; the conversation happens on Discord.
--   course_discord  → one Discord server invite per class, shared by every group in it
--   group_discord   → each group's own channel in that server, and a webhook StudySync posts to
--   group_spots     → places members suggest; group_spot_votes → who likes which
--   group_meetup    → the place the group settled on

-- Is the logged-in student taking this class? (course = a course key, like study_groups.course)
create or replace function public.takes_course(p_course text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    where c.user_id = (select auth.uid()) and c.kind = 'class'
      and public.course_key(c.course_code, c.name) = p_course
  );
$$;
revoke execute on function public.takes_course(text) from public, anon;
grant execute on function public.takes_course(text) to authenticated;

create table if not exists public.course_discord (
  course      text primary key,                  -- course key, e.g. 'CSC 130'
  invite_url  text not null check (char_length(invite_url) <= 200),
  set_by      uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.course_discord enable row level security;

drop policy if exists "Classmates read the class Discord" on public.course_discord;
create policy "Classmates read the class Discord" on public.course_discord
  for select to authenticated using (public.takes_course(course));
drop policy if exists "Classmates add the class Discord" on public.course_discord;
create policy "Classmates add the class Discord" on public.course_discord
  for insert to authenticated with check (public.takes_course(course));
drop policy if exists "Classmates change the class Discord" on public.course_discord;
create policy "Classmates change the class Discord" on public.course_discord
  for update to authenticated using (public.takes_course(course)) with check (public.takes_course(course));
drop policy if exists "Classmates remove the class Discord" on public.course_discord;
create policy "Classmates remove the class Discord" on public.course_discord
  for delete to authenticated using (public.takes_course(course));

create table if not exists public.group_discord (
  group_id     uuid primary key references public.study_groups (id) on delete cascade,
  channel_url  text check (char_length(channel_url) <= 200),
  webhook_url  text check (char_length(webhook_url) <= 300),  -- the app never sends this to browsers
  updated_at   timestamptz not null default now()
);
alter table public.group_discord enable row level security;

drop policy if exists "Members read group Discord" on public.group_discord;
create policy "Members read group Discord" on public.group_discord
  for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members add group Discord" on public.group_discord;
create policy "Members add group Discord" on public.group_discord
  for insert to authenticated with check (public.is_group_member(group_id));
drop policy if exists "Members change group Discord" on public.group_discord;
create policy "Members change group Discord" on public.group_discord
  for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

create table if not exists public.group_spots (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.study_groups (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  place       text not null check (char_length(place) between 1 and 120),
  created_at  timestamptz not null default now()
);
create index if not exists group_spots_group_id_idx on public.group_spots (group_id, created_at);
alter table public.group_spots enable row level security;

drop policy if exists "Members read spots" on public.group_spots;
create policy "Members read spots" on public.group_spots
  for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members suggest spots" on public.group_spots;
create policy "Members suggest spots" on public.group_spots
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
drop policy if exists "Remove own spots" on public.group_spots;
create policy "Remove own spots" on public.group_spots
  for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.group_spot_votes (
  spot_id     uuid not null references public.group_spots (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (spot_id, user_id)
);
alter table public.group_spot_votes enable row level security;

drop policy if exists "Members read votes" on public.group_spot_votes;
create policy "Members read votes" on public.group_spot_votes
  for select to authenticated
  using (exists (select 1 from public.group_spots s where s.id = spot_id and public.is_group_member(s.group_id)));
drop policy if exists "Members vote" on public.group_spot_votes;
create policy "Members vote" on public.group_spot_votes
  for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.group_spots s where s.id = spot_id and public.is_group_member(s.group_id)));
drop policy if exists "Take back own vote" on public.group_spot_votes;
create policy "Take back own vote" on public.group_spot_votes
  for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.group_meetup (
  group_id    uuid primary key references public.study_groups (id) on delete cascade,
  place       text not null check (char_length(place) between 1 and 120),
  set_by      uuid default auth.uid() references auth.users (id) on delete set null,
  set_at      timestamptz not null default now()
);
alter table public.group_meetup enable row level security;

drop policy if exists "Members read meetup" on public.group_meetup;
create policy "Members read meetup" on public.group_meetup
  for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members set meetup" on public.group_meetup;
create policy "Members set meetup" on public.group_meetup
  for insert to authenticated with check (public.is_group_member(group_id));
drop policy if exists "Members change meetup" on public.group_meetup;
create policy "Members change meetup" on public.group_meetup
  for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
drop policy if exists "Members clear meetup" on public.group_meetup;
create policy "Members clear meetup" on public.group_meetup
  for delete to authenticated using (public.is_group_member(group_id));
