-- StudySync: quick edits to this week's solo study sessions (move, change length, skip).
-- Same as the line in schema.sql, on its own so it's quick to run.
-- Supabase dashboard → SQL Editor → paste this → Run. Safe to run more than once.

alter table public.profiles add column if not exists study_edits jsonb;
