import { z } from "zod";
import { MasteryLevelSchema } from "./primitives";

export const CompetencyScoreSchema = z.object({
  competency: z.string(),
  score: z.number(),
  evidence: z.string(),
  level: MasteryLevelSchema,
});
export type CompetencyScore = z.infer<typeof CompetencyScoreSchema>;

export const LanguageReportSchema = z.object({
  fluency_score: z.number(),
  filler_word_count: z.number().int(),
  clarity_score: z.number(),
  code_switching_notes: z.string(),
  pronunciation_notes: z.string(),
  summary: z.string(),
});
export type LanguageReport = z.infer<typeof LanguageReportSchema>;

export const ModelAnswerSchema = z.object({
  question_id: z.string(),
  answer: z.string(),
});
export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;

// One structured growth item: the prose the report shows PLUS the competency
// key it maps to. The key is the join that lets the Prep Coach build a module,
// card and mock-practice drill from a report weakness (previously the coach
// only saw the separate, score-banded `weak_competencies`, so the report page
// and the coach page could disagree). `competency` is either an exact name from
// `competency_scores` or a canonical skill label the drill pipeline will target.
export const GrowthItemSchema = z.object({
  text: z.string(),
  competency: z.string(),
  actions: z.array(z.string()).default([]),
});
export type GrowthItem = z.infer<typeof GrowthItemSchema>;

export const ScoreCardSchema = z.object({
  overall_score: z.number(),
  competency_scores: z.array(CompetencyScoreSchema),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  weak_competencies: z.array(z.string()),
  model_answers: z.array(ModelAnswerSchema),
  next_steps: z.array(z.string()),
  language_report: LanguageReportSchema,
  summary: z.string(),
  // Structured weaknesses that drive the coach plan (report == drill source).
  // Defaults to [] so scorecards persisted before this field still validate.
  growth_items: z.array(GrowthItemSchema).default([]),
  // Fraction of planned questions actually answered (0.0-1.0). Unanswered
  // questions are excluded from overall_score and weak_competencies; this lets
  // consumers tell a short/aborted interview apart from genuinely weak answers.
  // Defaults to 1.0 for scorecards persisted before this field existed.
  coverage_pct: z.number().default(1.0),
});
export type ScoreCard = z.infer<typeof ScoreCardSchema>;
