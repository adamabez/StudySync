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

-- Async classes have no set time (for projects created before this was allowed)
alter table public.classes alter column start_time drop not null;
alter table public.classes alter column end_time drop not null;

-- Speed up "my rows" lookups
create index if not exists classes_user_id_idx on public.classes (user_id);
create index if not exists sources_user_id_idx on public.sources (user_id);
create index if not exists chats_user_id_updated_idx on public.chats (user_id, updated_at desc);

-- ---------- Row Level Security: each user only sees their own rows ----------
alter table public.classes            enable row level security;
alter table public.sources            enable row level security;
alter table public.chats              enable row level security;
alter table public.canvas_connections enable row level security;
alter table public.feedback           enable row level security;

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
