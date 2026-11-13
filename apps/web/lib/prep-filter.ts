import type { Flashcard } from "@/lib/sample-mastery";

/**
 * Which study module the flashcard deck is currently filtered to. Comes from
 * `/prep?module=<id>` resolved server-side in app/prep/page.tsx; `title` is
 * display-only, `competency` is the join key onto the card pool (same field
 * study modules are built around).
 */
export interface ActiveModuleInfo {
  title: string;
  competency: string;
}

/**
 * Pure decision behind "Start studying": which cards the review session sees.
 *  - no module selected (or the user dismissed the filter) → the full deck;
 *  - a module selected → only cards whose competency matches it. An empty
 *    result is meaningful (real coach-plan competencies may have no cards in
 *    the deck) and rendered as a fallback by the caller, not silently widened.
 */
export function selectVisibleCards(
  cards: Flashcard[],
  activeModule: ActiveModuleInfo | null,
  dismissed: boolean,
): Flashcard[] {
  if (!activeModule || dismissed) return cards;
  return cards.filter((c) => c.competency === activeModule.competency);
}

/**
 * Minimal structural inputs for `buildStudyCards` — deliberately duck-typed
 * subsets of the shared `PlannedQuestion` / `ModelAnswer` contracts so the
 * assembly rule stays unit-testable without full plan fixtures.
 */
export interface CardQuestionInput {
  id: string;
  text: Record<string, string>;
  target_competency: string;
}
export interface CardModelAnswerInput {
  question_id: string;
  answer: string;
}

/**
 * Real-deck assembly (no LLM, no new API): the candidate's own weak-area
 * questions from the interview plan, each paired with the model answer the
 * post pipeline wrote into the scorecard.
 *
 * Selection: a question becomes a card only when its `target_competency` is
 * in `weakCompetencies` AND a model answer exists for it. Text keys follow
 * the INTERVIEW language (`language` — planner writes en + primary; legacy
 * single-locale plans fall back to `en`). `competency` stays the shared
 * English dimension key, which is what keeps the "Start studying" module
 * filter aligned with real coach-plan modules.
 *
 * An empty result means "no real deck yet" — the caller falls back to the
 * sample deck, not an empty card area.
 */
export function buildStudyCards(
  questions: CardQuestionInput[],
  modelAnswers: CardModelAnswerInput[],
  weakCompetencies: string[],
  language: string,
): Flashcard[] {
  const weak = new Set(weakCompetencies);
  const answerByQ = new Map(modelAnswers.map((a) => [a.question_id, a.answer]));
  const cards: Flashcard[] = [];
  for (const q of questions) {
    if (!weak.has(q.target_competency)) continue;
    const answer = answerByQ.get(q.id);
    if (!answer) continue;
    cards.push({
      id: q.id,
      front: q.text[language] ?? q.text.en ?? "",
      back: answer,
      competency: q.target_competency,
    });
  }
  return cards;
}
