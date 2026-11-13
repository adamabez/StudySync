-- StudySync demo data: 20 fake students, each with 3-4 Sac State classes.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Run supabase/schema.sql and supabase/courses.sql first.
--
-- Creates confirmed accounts directly, so no confirmation emails are sent (and the
-- email rate limit doesn't matter). Safe to run more than once: existing demo
-- accounts are reused and their classes are replaced.
--
-- Log in as any of them:
--   Email:    demo01@example.com ... demo20@example.com
--   Password: StudySync-demo-2026
--
-- To remove every demo account later, run the "Clean up" query at the bottom.

-- ---------- Class sections (shared, so students in the same class match) ----------
drop table if exists seed_sections;
create temp table seed_sections (
  code text primary key, days text[], start_time text, end_time text, room text
);
insert into seed_sections values
  ('CSC 20',   '{mon,wed}', '09:00', '10:15', 'RVR 1013'),
  ('CSC 35',   '{tue,thu}', '09:00', '10:15', 'RVR 1009'),
  ('CSC 130',  '{mon,wed}', '10:30', '11:45', 'RVR 1010'),
  ('CSC 131',  '{tue,thu}', '12:00', '13:15', 'RVR 5029'),
  ('CSC 133',  '{mon,wed}', '13:30', '14:45', 'SQU 304'),
  ('CSC 135',  '{tue,thu}', '10:30', '11:45', 'RVR 1002'),
  ('CSC 137',  '{mon,wed}', '15:00', '16:15', 'RVR 2004'),
  ('CSC 139',  '{tue,thu}', '15:00', '16:15', 'SQU 116'),
  ('MATH 30',  '{tue,thu}', '13:30', '14:45', 'BRH 211'),
  ('MATH 31',  '{mon,wed}', '12:00', '13:15', 'BRH 115'),
  ('MATH 45',  '{mon,wed}', '16:30', '17:45', 'BRH 210'),
  ('STAT 1',   '{mon,wed}', '13:30', '14:45', 'AMD 150'),
  ('STAT 50',  '{mon,wed}', '12:00', '13:15', 'AMD 152'),
  ('CHEM 1A',  '{tue,thu}', '09:00', '10:15', 'SQU 142'),
  ('BIO 10',   '{tue,thu}', '15:00', '16:15', 'SQU 124'),
  ('PSYC 2',   '{mon,wed}', '09:00', '10:15', 'AMD 101'),
  ('ECON 1A',  '{tue,thu}', '10:30', '11:45', 'MND 1003'),
  ('PHIL 4',   '{mon,wed}', '16:30', '17:45', 'MND 1015'),
  ('ENGL 20',  '{tue,thu}', '16:30', '17:45', 'CAL 110'),
  ('COMS 4',   '{mon,wed}', '15:00', '16:15', 'MND 2006');

-- ---------- The 20 students ----------
drop table if exists seed_people;
create temp table seed_people (
  n int primary key, display_name text, pref text, hours int, codes text[]
);
insert into seed_people values
  ( 1, 'Maya Patel',       'group',  8, '{CSC 130,CSC 131,MATH 45,STAT 50}'),
  ( 2, 'Jordan Lee',       'group',  6, '{CSC 130,CSC 131,CSC 135}'),
  ( 3, 'Sofia Hernandez',  'group',  6, '{CSC 20,MATH 30,ENGL 20,COMS 4}'),
  ( 4, 'Ethan Nguyen',     'alone', 10, '{CSC 130,CSC 133,CSC 135,STAT 50}'),
  ( 5, 'Aaliyah Johnson',  'group',  5, '{CSC 20,CSC 35,MATH 30}'),
  ( 6, 'Lucas Kim',        'group',  9, '{CSC 131,CSC 133,CSC 137,CSC 139}'),
  ( 7, 'Priya Singh',      'group',  7, '{CSC 130,CSC 135,MATH 45,STAT 50}'),
  ( 8, 'Diego Ramirez',    'group',  6, '{CSC 35,MATH 31,ENGL 20,COMS 4}'),
  ( 9, 'Hannah Wright',    'group',  5, '{PSYC 2,STAT 1,BIO 10,ENGL 20}'),
  (10, 'Marcus Brown',     'alone',  8, '{CSC 133,CSC 137,CSC 139}'),
  (11, 'Emily Chen',       'group',  7, '{CSC 20,CSC 35,MATH 30,ENGL 20}'),
  (12, 'Omar Haddad',      'group',  6, '{CSC 131,CSC 135,MATH 45}'),
  (13, 'Isabella Garcia',  'group',  5, '{PSYC 2,STAT 1,ECON 1A,PHIL 4}'),
  (14, 'Tyler Morris',     'group',  8, '{CSC 130,CSC 137,CSC 139,STAT 50}'),
  (15, 'Grace Okafor',     'alone',  9, '{PSYC 2,MATH 31,CHEM 1A,BIO 10}'),
  (16, 'Ryan Castillo',    'group',  4, '{CSC 35,MATH 31,PHIL 4}'),
  (17, 'Zoe Thompson',     'group',  7, '{CSC 131,CSC 133,CSC 135,MATH 45}'),
  (18, 'Nathan Vu',        'group',  6, '{CSC 20,MATH 30,COMS 4}'),
  (19, 'Ava Martinez',     'group',  5, '{PSYC 2,STAT 1,ECON 1A,ENGL 20}'),
  (20, 'Kevin Alvarez',    'group',  8, '{CSC 130,CSC 137,CSC 139,MATH 45}');

-- ---------- Create the accounts, profiles and classes ----------
do $$
declare
  p   record;
  uid uuid;
  em  text;
begin
  for p in select * from seed_people order by n loop
    em := format('demo%s@example.com', lpad(p.n::text, 2, '0'));
    select id into uid from auth.users where email = em;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
        extensions.crypt('StudySync-demo-2026', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(),
        '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;

    -- Profile: onboarding done, so they land straight on the dashboard
    insert into public.profiles (user_id, onboarded_at, study_preference, weekly_study_hours, display_name)
    values (uid, now(), p.pref, p.hours, p.display_name)
    on conflict (user_id) do update set
      onboarded_at       = excluded.onboarded_at,
      study_preference   = excluded.study_preference,
      weekly_study_hours = excluded.weekly_study_hours,
      display_name       = excluded.display_name;

    -- Classes (replaced on every run)
    delete from public.classes where user_id = uid and kind = 'class';
    insert into public.classes (user_id, kind, name, course_code, location, days, start_time, end_time)
    select uid, 'class', s.code,
           (select c.code from public.courses c where c.code = s.code),  -- null if courses.sql wasn't run
           s.room, s.days, s.start_time, s.end_time
    from seed_sections s
    where s.code = any (p.codes);
  end loop;
end $$;

drop table seed_sections;
drop table seed_people;

-- Check: one row per demo student with their classes
select u.email, pr.display_name, pr.study_preference,
       string_agg(c.name, ', ' order by c.name) as classes
from auth.users u
join public.profiles pr on pr.user_id = u.id
left join public.classes c on c.user_id = u.id and c.kind = 'class'
where u.email like 'demo__@example.com'
group by u.email, pr.display_name, pr.study_preference
order by u.email;

-- ---------- Clean up (run on its own to delete every demo account and its data) ----------
-- delete from auth.users where email like 'demo__@example.com';
