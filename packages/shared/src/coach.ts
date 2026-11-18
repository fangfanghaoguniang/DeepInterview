import { z } from "zod";
import { LanguageSchema } from "./primitives";
import { CitationSchema } from "./company";

// Mastery state for a study module (matches the web StudyModule union in
// apps/web/lib/sample-mastery.ts). Distinct from MasteryLevel (scoring bands).
export const MasteryStateSchema = z.enum([
  "unseen",
  "learning",
  "shaky",
  "mastered",
]);
export type MasteryState = z.infer<typeof MasteryStateSchema>;

// One ordered step in the gap -> study path, built from a weak competency.
export const StudyModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  competency: z.string(),
  status: MasteryStateSchema,
  est_min: z.number().int(),
  rationale: z.string(),
});
export type StudyModule = z.infer<typeof StudyModuleSchema>;

// The Study Coach's curriculum, derived from a scorecard's weak_competencies.
export const StudyPlanSchema = z.object({
  modules: z.array(StudyModuleSchema),
  summary: z.string(),
  total_min: z.number().int(),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

export const StudyCardSchema = z.object({
  id: z.string(),
  competency: z.string(),
  front: z.string(),
  back: z.string(),
  source: z.enum(["interview", "drill"]),
});
export const StudyTargetSchema = z.object({
  module: StudyModuleSchema,
  growth: z.array(z.string()),
  actions: z.array(z.string()),
  material_status: z.enum(["pending", "ready", "failed"]),
  error: z.string().nullable().default(null),
  cards: z.array(StudyCardSchema).default([]),
});
export const CoachFeedbackSchema = z.object({
  module_id: z.string(),
  mastery: MasteryStateSchema.nullable().default(null),
  note: z.string(),
});
export const CoachRunSchema = z.object({
  id: z.string(),
  version: z.string(),
  entry_module: z.string().nullable().default(null),
  status: z.enum(["running", "pending", "ready", "failed"]),
  started_at: z.number(),
  feedback: z.array(CoachFeedbackSchema).default([]),
});
export const StudyViewSchema = z.object({
  session_id: z.string(),
  version: z.string(),
  language: LanguageSchema,
  role: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  status: z.enum(["idle", "preparing", "ready", "failed", "empty"]),
  error: z.string().nullable().default(null),
  targets: z.array(StudyTargetSchema),
  coach_run: CoachRunSchema.nullable().default(null),
});
export type StudyCard = z.infer<typeof StudyCardSchema>;
export type StudyTarget = z.infer<typeof StudyTargetSchema>;
export type StudyView = z.infer<typeof StudyViewSchema>;
export type CoachRun = z.infer<typeof CoachRunSchema>;

// A learner's question to the coach chat.
export const CoachChatRequestSchema = z.object({
  session_id: z.string(),
  query: z.string(),
  lang: LanguageSchema,
});
export type CoachChatRequest = z.infer<typeof CoachChatRequestSchema>;

// A grounded, synthesized coaching answer with sources and suggested follow-ups.
export const CoachReplySchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  follow_ups: z.array(z.string()),
});
export type CoachReply = z.infer<typeof CoachReplySchema>;
