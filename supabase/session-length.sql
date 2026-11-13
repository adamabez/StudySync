-- StudySync: let students pick how long their study sessions are (short / medium / long).
-- Same as the line in schema.sql, on its own so it's quick to run.
-- Supabase dashboard → SQL Editor → paste this → Run. Safe to run more than once.

alter table public.profiles add column if not exists study_session_length text
  check (study_session_length in ('short', 'medium', 'long'));
