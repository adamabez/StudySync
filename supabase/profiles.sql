-- StudySync - profiles: a photo, major, year and classes for your study groups to see. The photo
-- always shows to them; major, year and classes can each be kept to yourself.
-- Run this once in the Supabase SQL Editor (it's also at the end of schema.sql). Safe to run again.
--
-- Who sees what:
--   - You see all of your own profile.
--   - Someone who shares a study group with you sees your name, plus each part you share
--     (your photo always; major, year and classes unless you switch them off).
--   - Nobody else sees anything: there's no public profile page or search.
-- The browser never gets anyone's user ID: each profile has a random profile_id instead.

alter table public.profiles add column if not exists profile_id uuid default gen_random_uuid();
update public.profiles set profile_id = gen_random_uuid() where profile_id is null;
create unique index if not exists profiles_profile_id_key on public.profiles (profile_id);

alter table public.profiles add column if not exists major text check (char_length(major) <= 60);
alter table public.profiles add column if not exists class_year text
  check (class_year in ('freshman', 'sophomore', 'junior', 'senior', 'grad'));
alter table public.profiles add column if not exists photo_updated_at timestamptz;  -- null = no photo
alter table public.profiles add column if not exists share_photo   boolean not null default true;
alter table public.profiles add column if not exists share_major   boolean not null default true;
alter table public.profiles add column if not exists share_year    boolean not null default true;
alter table public.profiles add column if not exists share_classes boolean not null default true;
-- Shared with your study groups by default (each can be switched off on the profile page)
alter table public.profiles alter column share_photo set default true;
alter table public.profiles alter column share_major set default true;
alter table public.profiles alter column share_year set default true;
alter table public.profiles alter column share_classes set default true;

-- Do you share a study group with this person? (Or are they you?)
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select other = (select auth.uid()) or exists (
    select 1 from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.shares_group_with(uuid) to authenticated;

-- May the logged-in student see the photo stored under this profile ID? (Used by the storage
-- rules below: photos live at avatars/<profile_id>/photo.webp.)
create or replace function public.can_see_photo(pid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.profile_id::text = pid
      and (p.user_id = (select auth.uid()) or (p.share_photo and public.shares_group_with(p.user_id)))
  );
$$;
revoke execute on function public.can_see_photo(text) from public, anon;
grant execute on function public.can_see_photo(text) to authenticated;

-- Is this profile ID yours? (Storage rules: you can only upload or delete your own photo.)
create or replace function public.is_my_profile(pid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.profile_id::text = pid and p.user_id = (select auth.uid()));
$$;
revoke execute on function public.is_my_profile(text) from public, anon;
grant execute on function public.is_my_profile(text) to authenticated;

-- One person's profile card, with only what you're allowed to see. Null if you don't share a
-- group with them. Classes come from their schedule (classes only, not tasks or other items).
create or replace function public.member_profile(pid uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'profileId', p.profile_id,
    'name', coalesce(nullif(btrim(p.display_name), ''), nullif(left(btrim(u.raw_user_meta_data ->> 'name'), 40), ''), 'Classmate'),
    'isYou', p.user_id = (select auth.uid()),
    'photo', case when p.photo_updated_at is not null and (p.share_photo or p.user_id = (select auth.uid()))
                  then extract(epoch from p.photo_updated_at)::bigint end,
    'major', case when p.share_major or p.user_id = (select auth.uid()) then nullif(p.major, '') end,
    'year', case when p.share_year or p.user_id = (select auth.uid()) then p.class_year end,
    'classes', case when p.share_classes or p.user_id = (select auth.uid()) then coalesce((
        select json_agg(distinct c.name) from public.classes c where c.user_id = p.user_id and c.kind = 'class'
      ), '[]'::json) end
  )
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.profile_id = pid and public.shares_group_with(p.user_id);
$$;
revoke execute on function public.member_profile(uuid) from public, anon;
grant execute on function public.member_profile(uuid) to authenticated;

-- Group members now also come with their profile ID and photo (when shared), so their circles
-- can show it and open their card. Same rule as before: members only.
drop function if exists public.group_member_names(uuid);
create function public.group_member_names(gid uuid)
returns table (user_id uuid, name text, joined_at timestamptz, profile_id uuid, photo bigint)
language sql stable security definer set search_path = ''
as $$
  select m.user_id,
         coalesce(nullif(btrim(p.display_name), ''),
                  nullif(left(btrim(u.raw_user_meta_data ->> 'name'), 40), ''),
                  'Classmate'),
         m.joined_at,
         p.profile_id,
         case when p.photo_updated_at is not null and (p.share_photo or m.user_id = (select auth.uid()))
              then extract(epoch from p.photo_updated_at)::bigint end
  from public.group_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.group_id = gid and public.is_group_member(gid)
  order by m.joined_at;
$$;
revoke execute on function public.group_member_names(uuid) from public, anon;
grant execute on function public.group_member_names(uuid) to authenticated;

-- ---------- Photos ----------
-- A private bucket. Each photo is a small square (the browser shrinks it to 256 × 256 first).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 262144, array['image/webp', 'image/jpeg'])  -- 256 KB
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatars: read if allowed" on storage.objects;
create policy "Avatars: read if allowed" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.can_see_photo((storage.foldername(name))[1]));

drop policy if exists "Avatars: upload own" on storage.objects;
create policy "Avatars: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_my_profile((storage.foldername(name))[1]));

drop policy if exists "Avatars: replace own" on storage.objects;
create policy "Avatars: replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.is_my_profile((storage.foldername(name))[1]));

drop policy if exists "Avatars: delete own" on storage.objects;
create policy "Avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.is_my_profile((storage.foldername(name))[1]));
