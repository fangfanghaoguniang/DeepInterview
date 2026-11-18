-- 0001_pg_init.sql — consolidated schema for native (self-hosted) Postgres.
-- Equivalent to supabase/migrations/0001-0008 but stripped of Supabase-specific
-- infrastructure (auth.users FK, profiles table, row-level security, triggers on
-- auth). Run this once against your target database:
--
--   createdb deepinterview
--   psql -d deepinterview -f postgres/migrations/0001_pg_init.sql
--
create table if not exists sessions (
  id              text primary key,
  user_id         text,                          -- nullable; multi-user later
  status          text not null default 'prep',
  company         text,
  cv_url          text,
  jd_text         text,
  language_mode   jsonb not null default '{"primary":"en","mixed":false}'::jsonb,
  context         jsonb,
  scorecard       jsonb,
  transcript      jsonb,
  coach_transcript jsonb,
  practice_state  jsonb not null default '{}'::jsonb,
  drill_items     jsonb not null default '[]'::jsonb,
  progress        jsonb not null default '[]'::jsonb,
  prep_warnings   jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-touch updated_at on every write (same behaviour as the Supabase trigger).
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_touch on sessions;
create trigger sessions_touch
  before update on sessions
  for each row execute function touch_updated_at();

-- Index for the landing page "latest completed" query.
create index if not exists idx_sessions_status_created
  on sessions (status, created_at desc)
  where status = 'complete';
