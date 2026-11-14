-- StudySync - solo notes: your own private notes on the Notes page (lib/solonotes.js).
-- Only you can see, add or delete yours. Run once in the Supabase SQL Editor (also in schema.sql).

create table if not exists public.solo_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 20000),
  created_at  timestamptz not null default now()
);

create index if not exists solo_notes_user_idx on public.solo_notes (user_id, created_at desc);

alter table public.solo_notes enable row level security;

drop policy if exists "Read own solo notes" on public.solo_notes;
create policy "Read own solo notes" on public.solo_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Add own solo notes" on public.solo_notes;
create policy "Add own solo notes" on public.solo_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Delete own solo notes" on public.solo_notes;
create policy "Delete own solo notes" on public.solo_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));
