import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InterviewContextSchema,
  LocalizedTextSchema,
  SAMPLE_INTERVIEW_CONTEXT,
  SCHEMAS,
  PrepSourceSchema,
  StudyViewSchema,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("InterviewContext round-trip", () => {
  it("parses the sample fixture without throwing", () => {
    const fixture = readJson("interview-context.sample.json");
    expect(() => InterviewContextSchema.parse(fixture)).not.toThrow();
  });

  it("round-trips parsed object through JSON deep-equal", () => {
    const fixture = readJson("interview-context.sample.json");
    const parsed = InterviewContextSchema.parse(fixture);
    const roundTripped = JSON.parse(JSON.stringify(parsed));
    expect(roundTripped).toEqual(parsed);
  });

  it("validates SAMPLE_INTERVIEW_CONTEXT against the Zod refines (the /api/health payload)", () => {
    // SAMPLE_INTERVIEW_CONTEXT is only TS-typed; TS cannot check Zod refines
    // (en-required, difficulty 1-5, weight 0-1). Parse it so an invalid sample
    // fails here at test time, not at runtime when /api/health is hit.
    expect(() =>
      InterviewContextSchema.parse(SAMPLE_INTERVIEW_CONTEXT),
    ).not.toThrow();
    const parsedSample = InterviewContextSchema.parse(SAMPLE_INTERVIEW_CONTEXT);
    const parsedFixture = InterviewContextSchema.parse(
      readJson("interview-context.sample.json"),
    );
    expect(parsedSample).toEqual(parsedFixture);
  });
});

describe("LocalizedText en-required invariant", () => {
  it("rejects a localized text map missing the en entry", () => {
    const missingEn = readJson("localized-text-missing-en.invalid.json");
    const result = LocalizedTextSchema.safeParse(missingEn);
    expect(result.success).toBe(false);
  });

  it("accepts a localized text map with a non-empty en entry", () => {
    const result = LocalizedTextSchema.safeParse({
      en: "hello",
      vi: "xin chào",
    });
    expect(result.success).toBe(true);
  });
});

describe("SCHEMAS registry", () => {
  it("包含学习与来源合同的 34 个注册项", () => {
    expect(Object.keys(SCHEMAS)).toHaveLength(34);
    expect(SCHEMAS).toHaveProperty("StudyView");
    expect(SCHEMAS).toHaveProperty("PrepSource");
  });
});

describe("学习闭环嵌套合同", () => {
  it("旧报告补默认字段，重点来源未考查保持 null", () => {
    const ctx = InterviewContextSchema.parse(readJson("interview-context.sample.json"));
    expect(ctx.focus_source).toBeNull();
    const focus = { session_id: "original", version: "v1", module_id: "goal_1",
      competency: "系统设计", growth: ["估算不充分"], actions: ["练习容量计算"] };
    const source = PrepSourceSchema.parse({ input: {
      cv_url: "原始简历", jd_text: "原始岗位", company: "原公司",
      language_mode: { primary: "zh", mixed: false },
      source_session_id: "original", focus_competency: "系统设计",
    }, focus });
    expect(source.focus.baseline).toBeNull();
    expect(source.input.user_id).toBeUndefined();
    const next = InterviewContextSchema.parse({ ...ctx, focus_source: source.focus });
    expect(InterviewContextSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it("实际回答但未可靠判断的反馈可为空，非法掌握度不可通过", () => {
    const view = StudyViewSchema.parse({ session_id: "s", version: "v", language: "zh",
      status: "ready", targets: [{
        module: { id: "goal_1", title: "系统设计", competency: "系统设计",
          status: "learning", est_min: 25, rationale: "成长原句" },
        growth: ["成长原句"], actions: ["行动原句"], material_status: "ready",
        cards: [{ id: "q1", competency: "系统设计", front: "原题", back: "参考答案", source: "interview" }],
      }], coach_run: { id: "run1", version: "v", started_at: 1, status: "ready",
        feedback: [{ module_id: "goal_1", note: "未形成可靠判断" }] },
    });
    expect(view.coach_run?.feedback[0]?.mastery).toBeNull();
    expect(StudyViewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(StudyViewSchema.safeParse({ ...view, coach_run: { ...view.coach_run,
      feedback: [{ module_id: "goal_1", mastery: "expert", note: "不合法" }],
    } }).success).toBe(false);
  });
});
