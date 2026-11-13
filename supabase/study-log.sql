-- StudySync: "I studied" checkmarks on solo study sessions and study group meetings.
-- Same as the study_log part of schema.sql, on its own so it's quick to run.
-- Supabase dashboard → SQL Editor → paste this → Run. Safe to run more than once.

-- One row per study session a student checked off, by date (so each week starts fresh)
create table if not exists public.study_log (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  start_time  text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  kind        text not null default 'solo' check (kind in ('solo', 'group')),  -- own study time, or a study group meeting
  group_id    uuid,                                                          -- which study group (kind = 'group')
  created_at  timestamptz not null default now(),
  primary key (user_id, date, start_time)
);
-- (for projects that made study_log before group check-offs existed)
alter table public.study_log add column if not exists kind text not null default 'solo' check (kind in ('solo', 'group'));
alter table public.study_log add column if not exists group_id uuid;

-- Everyone sees and changes only their own checkmarks
alter table public.study_log enable row level security;
drop policy if exists "Own study log" on public.study_log;
create policy "Own study log" on public.study_log
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.study_log to authenticated;
