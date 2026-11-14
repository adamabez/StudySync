-- StudySync - private notes: notes only you can see, on the Notes page (lib/privatenotes.js).
-- A private note can belong to one of your groups (group_id) without being shared with it;
-- sharing it moves it to group_notes, and making a group note private moves it back here.
-- Only you can see, add or delete yours. Run once in the Supabase SQL Editor (also in schema.sql).

create table if not exists public.private_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id    uuid references public.study_groups (id) on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 20000),
  created_at  timestamptz not null default now()
);

create index if not exists private_notes_user_idx on public.private_notes (user_id, created_at desc);

alter table public.private_notes enable row level security;

drop policy if exists "Read own private notes" on public.private_notes;
create policy "Read own private notes" on public.private_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Add own private notes" on public.private_notes;
create policy "Add own private notes" on public.private_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (group_id is null or public.is_group_member(group_id)));

drop policy if exists "Delete own private notes" on public.private_notes;
create policy "Delete own private notes" on public.private_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));
