-- StudySync: one-time items on the schedule (a task or "other" on one date, not every week).
-- Same as the matching lines in schema.sql, on their own so they're quick to run.
-- Supabase dashboard → SQL Editor → paste this → Run. Safe to run more than once.

-- The date a one-time item happens. null = every week on its days (classes always are).
alter table public.classes add column if not exists on_date date;

-- Study group matching: one-time items don't block a weekly group time
create or replace function public.user_is_free(p_user uuid, p_days text[], p_start text, p_end text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.classes c
    where c.user_id = p_user
      and c.start_time is not null
      and c.on_date is null
      and c.days && p_days
      and c.start_time < p_end
      and p_start < c.end_time
  );
$$;
