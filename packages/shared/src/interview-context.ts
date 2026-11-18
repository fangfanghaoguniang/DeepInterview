import { z } from "zod";
import { AnswerRecordSchema } from "./answer";
import { CandidateProfileSchema } from "./candidate";
import { CompanyIntelSchema } from "./company";
import { GapAnalysisSchema } from "./gap";
import { JobSpecSchema } from "./job";
import { QuestionPlanSchema } from "./question";
import { CompetencyScoreSchema, ScoreCardSchema } from "./score";

export const FocusSourceSchema = z.object({
  session_id: z.string(),
  version: z.string(),
  module_id: z.string(),
  competency: z.string(),
  growth: z.array(z.string()),
  actions: z.array(z.string()),
  baseline: CompetencyScoreSchema.nullable().default(null),
});
export type FocusSource = z.infer<typeof FocusSourceSchema>;

export const InterviewContextSchema = z.object({
  session_id: z.string(),
  candidate: CandidateProfileSchema,
  job: JobSpecSchema,
  company: CompanyIntelSchema,
  gap: GapAnalysisSchema,
  plan: QuestionPlanSchema,
  cursor: z.number().int().default(0),
  answers: z.array(AnswerRecordSchema).default([]),
  scorecard: ScoreCardSchema.nullable().default(null),
  focus_source: FocusSourceSchema.nullable().default(null),
});
export type InterviewContext = z.infer<typeof InterviewContextSchema>;
