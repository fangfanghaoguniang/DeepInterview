import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { SAMPLE_INTERVIEW_CONTEXT, type InterviewContext } from "@deepinterview/shared";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "zh" }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/env", () => ({ serverEnv: { agentApiUrl: "http://test-agent" } }));

import ReportPage from "../app/report/[id]/page";
import { Flashcards } from "../components/prep/flashcards";
import { SAMPLE_SCORECARD } from "../lib/sample-scorecard";

const network = vi.fn<typeof fetch>();
beforeEach(() => { network.mockReset(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.unstubAllGlobals(); });

async function report(id = "current") {
  const stream = await renderToReadableStream(await ReportPage({ params: Promise.resolve({ id }) }));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<!--.*?-->/g, "");
}

function focusedContext(): InterviewContext {
  const context = structuredClone(SAMPLE_INTERVIEW_CONTEXT);
  const competency = SAMPLE_SCORECARD.competency_scores[0]!.competency;
  context.focus_source = { session_id: "source", version: "v1", module_id: "goal-source",
    competency, growth: ["补齐边界分析"], actions: ["练习新场景"], baseline: null };
  context.plan.questions[0]!.target_competency = competency;
  context.answers = [{ question_id: context.plan.questions[0]!.id, transcript: "本次真实作答",
    started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:01:00Z",
    duration_sec: 60, followups_asked: [] }];
  return context;
}

function serveReport(context: InterviewContext | null) {
  network.mockResolvedValueOnce(Response.json({ session_id: "current", status: "complete",
    progress: [], prep_warnings: [], context, scorecard: SAMPLE_SCORECARD }));
}

describe("报告真实结果与来源对照（服务端渲染）", () => {
  it("真实读取失败不输出示例报告，显式 sample 才预览", async () => {
    network.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    const failed = await report();
    expect(failed).toContain("报告暂不可读取");
    expect(failed).not.toContain(SAMPLE_SCORECARD.summary);
    network.mockClear();
    const sample = await report("sample");
    expect(sample).toContain("查看学习示例");
    expect(sample).toContain("/prep?preview=1");
    expect(network).not.toHaveBeenCalled();
  });

  it("读取正式报告只 GET，保留当前会话和原任务链接", async () => {
    serveReport(focusedContext());
    const html = await report();
    expect(html).toContain("根据这份报告开始学习");
    expect(html).toContain("/prep?session=current");
    expect(html).toContain("/report/source");
    expect(html).toContain("module=goal-source");
    expect(html).toContain("题目不同，仅作进步参考");
    expect(html).toContain("上次：未考查");
    expect(html).toContain(`本次：${SAMPLE_SCORECARD.competency_scores[0]!.score} 分`);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]![1]?.method).toBeUndefined();
  });

  it("有分数但重点题无实际回答时，不展示虚假重点对照分", async () => {
    const context = focusedContext();
    context.answers[0]!.transcript = " ";
    serveReport(context);
    const html = await report();
    expect(html).toContain("本次：未考查");
    expect(html).toContain("尚未形成该能力的有效评价，不计算进步幅度");
  });
});

describe("卡片真实与示例首屏边界（不替代浏览器交互验收）", () => {
  it("未传真实材料时显示空态，不误报复习完成", () => {
    const html = renderToStaticMarkup(createElement(Flashcards, {}));
    expect(html).toContain("暂无可用卡片");
    expect(html).not.toContain("本轮卡片复习完成");
    expect(html).not.toContain("示例卡片");
  });

  it("显式示例有上一张下一张，正面不能自评", () => {
    const html = renderToStaticMarkup(createElement(Flashcards, { mode: "preview" }));
    expect(html).toContain("示例卡片");
    expect(html).toContain("上一张");
    expect(html).toContain("下一张");
    expect(html).toContain("浏览不计入复习进度");
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(5);
  });
});
