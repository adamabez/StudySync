-- StudySync: let people without an account (the demo, the login page) send feedback.
-- Same as the feedback part of schema.sql, on its own so it's quick to run.
-- Supabase dashboard → SQL Editor → paste this → Run. Safe to run more than once.

-- Reports without an account have no user
alter table public.feedback alter column user_id drop not null;

-- Anonymous visitors can add a report (only without a user_id), never read any back
drop policy if exists "Send feedback without an account" on public.feedback;
create policy "Send feedback without an account" on public.feedback
  for insert to anon
  with check (user_id is null);
grant insert on public.feedback to anon;
