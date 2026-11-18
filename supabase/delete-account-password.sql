-- YoraBora - "Delete my account" checks the password inside the database too.
-- Run this once in the Supabase SQL Editor (it's also in schema.sql). Safe to run again.
--
-- Before: the server checked your password, then called delete_my_account(), which only needed
-- a login. Someone holding a stolen login session could call it directly and skip the password.
-- Now delete_my_account(p_password) compares the password with the saved (hashed) one itself,
-- so the account can't be deleted without it, no matter who calls.
--
-- The server (lib/auth.js deleteAccount) sends the password. Until this runs, it falls back to
-- the old delete_my_account(), so deleting an account keeps working either way.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.delete_my_account(p_password text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  saved text;
begin
  if uid is null then raise exception 'Not logged in'; end if;

  select u.encrypted_password into saved from auth.users u where u.id = uid;
  if saved is null or saved = '' or p_password is null
     or extensions.crypt(p_password, saved) <> saved then
    raise exception 'Wrong password' using errcode = '28P01';
  end if;

  -- Groups they started go to another member first, so classmates keep their group and notes
  update public.study_groups sg
  set created_by = (
    select m.user_id from public.group_members m
    where m.group_id = sg.id and m.user_id <> uid
    order by m.joined_at limit 1)
  where sg.created_by = uid
    and exists (select 1 from public.group_members m where m.group_id = sg.id and m.user_id <> uid);

  delete from public.study_groups where created_by = uid; -- groups only they were in
  delete from auth.users where id = uid;                  -- everything else cascades
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- The old version without a password can't be called any more
drop function if exists public.delete_my_account();
