import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import { serverEnv } from "@/lib/env";
import { SessionViewSchema, type SessionView } from "@/lib/session";

/**
 * Hero 右侧视觉：风格 A 定稿的评分卡（上一场分数 + 维度进度条 + 生成补课计划）。
 *
 * 仅在存在已完成的真实面试时渲染，无数据时返回 null（不展示模拟卡片）。
 */

const TONE_BAR: Record<string, string> = {
  danger: "bg-danger",
  warn: "bg-warn",
  accent: "bg-accent",
  ok: "bg-ok",
};

function toneForScore(pct: number): string {
  if (pct < 50) return "danger";
  if (pct < 70) return "warn";
  return "ok";
}

/** Fetch the latest completed session from the agent API (server-side). */
async function fetchLatestSession(): Promise<SessionView | null> {
  try {
    const res = await fetch(`${serverEnv.agentApiUrl}/api/sessions/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const parsed = SessionViewSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    // Only show if it actually has a scorecard with competency scores
    if (!parsed.data.scorecard || parsed.data.scorecard.competency_scores.length === 0) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function HeroMock() {
  const m = await getServerMessages();
  const session = await fetchLatestSession();

  // 没有已完成的面试则不渲染任何卡片
  if (!session) return null;

  const role = session.context?.job.title ?? null;
  const overallPct = Math.round((session.scorecard!.overall_score / 5) * 100);
  const dimensions = session.scorecard!.competency_scores.slice(0, 4).map((cs) => ({
    label: cs.competency,
    score: Math.round((cs.score / 5) * 100),
    tone: toneForScore((cs.score / 5) * 100),
  }));
  const sessionTag = role
    ? `上一场 · ${role}`
    : t(m, "landing.mock.sessionTag");

  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-line bg-panel p-6 shadow-[0_1px_2px_rgba(28,27,26,0.05),0_8px_24px_rgba(28,27,26,0.06)]"
    >
      {/* 表头：上一场元信息 + 完成状态 chip */}
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[14px] font-medium text-ink">
          {sessionTag}
        </span>
        <span className="rounded-full bg-ok/10 px-2.5 py-1 text-[12px] font-medium text-ok">
          {t(m, "landing.mock.statusDone")}
        </span>
      </div>

      {/* 综合分 + 目标线偏差（同行 baseline 排布，与设计稿一致） */}
      <div className="mb-6 flex items-end gap-3">
        <span className="serif text-[48px] font-bold leading-none tracking-tight text-ink">
          {overallPct}
        </span>
        <span className="pb-1.5 text-[13px] text-muted">
          /100 {t(m, "landing.mock.scoreSuffix")}
        </span>
      </div>

      {/* 维度进度 */}
      <div className="flex flex-col gap-3.5">
        {dimensions.map((dim, i) => (
          <div key={i}>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="text-muted">{dim.label}</span>
              <span className="font-medium text-ink">{dim.score}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-accent-soft">
              <div
                className={`h-1.5 rounded-full ${TONE_BAR[dim.tone] ?? "bg-ok"}`}
                style={{ width: `${dim.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 底部：把短板转成下一份练习计划 */}
      <div className="mt-6 w-full rounded-lg border border-accent/40 py-2.5 text-center text-[13.5px] font-medium text-accent-strong transition-colors hover:bg-accent-soft">
        {t(m, "landing.mock.generatePlan")}
      </div>
    </div>
  );
}
