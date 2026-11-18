-- YoraBora - profiles are shared with your study groups by default. Run this once in the
-- Supabase SQL Editor if you already ran supabase/profiles.sql before this change.
--
-- New profiles get everything shared (each part can be switched off on the profile page).
-- The update switches sharing on for everyone who already has a profile row: profiles were
-- brand new when this changed, so nobody had picked yet.

alter table public.profiles alter column share_photo set default true;
alter table public.profiles alter column share_major set default true;
alter table public.profiles alter column share_year set default true;
alter table public.profiles alter column share_classes set default true;

update public.profiles set share_photo = true, share_major = true, share_year = true, share_classes = true;
