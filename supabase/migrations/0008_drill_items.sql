-- 0008_drill_items.sql — targeted practice questions for overflow growth areas.
--
-- Under form Y the report can name a growth competency the interview never
-- asked about (no scored question, no model answer) — so the flashcard deck has
-- nothing to show for it. On demand the coach generates a few FRESH drill
-- questions for exactly that competency, each WITH a reference answer, and
-- stores them here so the deck can render them and a re-visit does not
-- regenerate.
--
-- Shape: a JSONB array of { id, competency, text: {lang: str}, answer }. It is
-- kept SEPARATE from context.plan.questions on purpose: the interview plan is a
-- sealed artifact once the mock ran (the loop grades answers against those exact
-- questions); drills are study-only extras that must never leak into scoring.
-- Default '[]' so existing rows and the memory store behave identically.
alter table public.sessions
  add column if not exists drill_items jsonb not null default '[]'::jsonb;
