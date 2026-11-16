-- 0007_practice_state.sql — per-session practice mastery for the study plan.
--
-- The prep page renders one StudyModule per reported growth area. Each module
-- carries a mastery state (unseen/learning/shaky/mastered) that must persist
-- ACROSS visits so the learner sees what they've already worked on — and so the
-- spoken coach (stage 4) can write back its informal self-assessment.
--
-- Shape: a JSONB object keyed by competency name -> mastery state, e.g.
--   {"System Design": "shaky", "Leadership": "learning"}
-- It hangs on the SAME interview session row (per-session, NOT a cross-session
-- aggregate): a new mock starts from a clean slate, matching how the report and
-- coach pages already treat "your last interview". Default '{}' so existing
-- rows and the memory store behave identically (no override until something is
-- written). Mirrors the coach_transcript precedent (0004): a distinct column so
-- it never collides with the interview/scoring payload.
alter table public.sessions
  add column if not exists practice_state jsonb not null default '{}'::jsonb;
