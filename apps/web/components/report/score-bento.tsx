import type { MasteryLevel, ScoreCard } from "@deepinterview/shared";
import { cn } from "@/lib/cn";
import { t, type Dictionary } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import { Eyebrow } from "@/components/ui/eyebrow";

/** Find a competency score by a case-insensitive substring match. */
function pick(scores: ScoreCard["competency_scores"], needle: string) {
  const n = needle.toLowerCase();
  return scores.find((c) => c.competency.toLowerCase().includes(n));
}

function verdict(m: Dictionary, score: number): string {
  if (score >= 4.25) return t(m, "report.verdictReady");
  if (score >= 3.25) return t(m, "report.verdictOnTrack");
  if (score >= 2) return t(m, "report.verdictNeedsWork");
  return t(m, "report.verdictEarly");
}

// The scorecard's level enum is wire data (always English); the bento sublabels
// localize it. Record<MasteryLevel, …> fails the build if the enum grows.
const LEVEL_KEYS: Record<MasteryLevel, "report.levelWeak" | "report.levelDeveloping" | "report.levelSolid" | "report.levelStrong"> = {
  weak: "report.levelWeak",
  developing: "report.levelDeveloping",
  solid: "report.levelSolid",
  strong: "report.levelStrong",
};

function levelLabel(m: Dictionary, level: MasteryLevel): string {
  return t(m, LEVEL_KEYS[level]);
}

type Metric = {
  label: string;
  value: string;
  sub: string;
  /** 0-5 fill for the hairline meter; null hides the meter. */
  fill: number | null;
};

/**
 * Bento grid: a tall serif "overall /5" hero on the left, a 2x2 of derived
 * top-metric cards on the right (Communication, Technical depth, STAR, Filler
 * words). Server component — pure render off the parsed ScoreCard.
 */
export async function ScoreBento({ scorecard }: { scorecard: ScoreCard }) {
  const m = await getServerMessages();
  const cs = scorecard.competency_scores;
  const lr = scorecard.language_report;

  const comm = pick(cs, "commun");
  const tech = pick(cs, "techn") ?? pick(cs, "system");
  const star = pick(cs, "star") ?? pick(cs, "behav");

  const metrics: Metric[] = [
    {
      label: t(m, "report.mComm"),
      value: comm ? comm.score.toFixed(1) : "—",
      sub: comm ? `${levelLabel(m, comm.level)} · /5` : t(m, "report.noSignal"),
      fill: comm ? comm.score : null,
    },
    {
      label: t(m, "report.mTech"),
      value: tech ? tech.score.toFixed(1) : "—",
      sub: tech ? `${levelLabel(m, tech.level)} · /5` : t(m, "report.noSignal"),
      fill: tech ? tech.score : null,
    },
    {
      label: t(m, "report.mStar"),
      value: star ? star.score.toFixed(1) : "—",
      sub: star ? `${levelLabel(m, star.level)} · /5` : t(m, "report.noSignal"),
      fill: star ? star.score : null,
    },
    {
      label: t(m, "report.mFiller"),
      value: String(lr.filler_word_count),
      sub: t(m, "report.fillerSub"),
      fill: null,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Hero */}
      <div className="md:row-span-1 flex flex-col justify-between rounded-card border border-line bg-panel p-6 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-28px_rgba(20,20,30,0.12)]">
        <Eyebrow>{t(m, "report.overall")}</Eyebrow>
        <div className="mt-4 flex items-baseline gap-1">
          <span className="font-serif text-[64px] leading-none text-ink">
            {scorecard.overall_score.toFixed(1)}
          </span>
          <span className="font-serif text-2xl text-faint">/5</span>
        </div>
        <p className="mt-3 text-sm text-muted">
          {verdict(m, scorecard.overall_score)}
        </p>
      </div>

      {/* 2x2 metric tiles */}
      <div className="grid grid-cols-2 gap-4 md:col-span-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex flex-col rounded-card border border-line bg-panel p-5 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-28px_rgba(20,20,30,0.12)]"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              {m.label}
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">{m.value}</p>
            <p className="mt-0.5 text-xs capitalize text-muted">{m.sub}</p>
            {m.fill !== null && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={cn(
                    "h-full rounded-full",
                    m.fill >= 3.25 ? "bg-accent" : "bg-faint",
                  )}
                  style={{ width: `${Math.min(100, (m.fill / 5) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
