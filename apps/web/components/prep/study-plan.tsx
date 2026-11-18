"use client";

import Link from "next/link";
import type { StudyTarget } from "@deepinterview/shared";
import { Clock, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusChip } from "@/components/prep/status-chip";
import { SAMPLE_STUDY_PLAN, type StudyModule } from "@/lib/sample-mastery";
import { t } from "@/lib/i18n";
import { useMessages } from "@/lib/i18n/client";

/**
 * The gap → path view: an ordered list of study modules built from the last
 * interview's weak competencies. Server component (no interactivity) — each
 * module is a card with its competency, mastery chip, "why it's here", and two
 * CTAs ("Start" to study, "Practice in a mock" to loop back into an interview).
 */
export function StudyPlan({
  modules = SAMPLE_STUDY_PLAN,
  weakAreas, targets, sessionId, version, onRetry, busy = false,
}: {
  modules?: StudyModule[];
  targets?: StudyTarget[];
  sessionId?: string;
  version?: string;
  onRetry?: (id: string) => void;
  busy?: boolean;
  /** Weak competencies from the last interview, for the header tie-in. */
  weakAreas?: string[];
}) {
  const msgs = useMessages();
  const source = sessionId ? `session=${encodeURIComponent(sessionId)}` : "preview=1";
  const totalMin = modules.reduce((sum, m) => sum + m.est_min, 0);
  const gaps = weakAreas?.length ? weakAreas : [t(msgs, "prep.yourWeakAreas")];
  // An empty module list means the coach ran successfully and found NO growth
  // areas (the sample fallback is never empty — SAMPLE_STUDY_PLAN has modules),
  // so render an honest localized empty state instead of a blank list.
  const isEmpty = modules.length === 0;

  return (
    <section aria-labelledby="study-plan-heading">
      <header className="mb-4">
        <Eyebrow>{t(msgs, "prep.eyebrow")}</Eyebrow>
        <h2
          id="study-plan-heading"
          className="mt-2 font-serif text-2xl text-ink"
        >
          {t(msgs, "prep.title")}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          {isEmpty ? (
            t(msgs, "prep.noGapsBody")
          ) : (
            <>
              {t(msgs, "prep.builtFrom")}
              {weakAreas?.length ? (
                <>
                  {" — "}
                  <span className="text-ink-soft">{gaps.join(", ")}</span>
                </>
              ) : null}
              . {t(msgs, "prep.planSummary").replace("{n}", String(modules.length)).replace("{min}", String(totalMin))}
            </>
          )}
        </p>
      </header>

      {isEmpty ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[13px] text-accent"
              aria-hidden
            >
              {"\u2713"}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-[17px] text-ink">
                {t(msgs, "prep.noGapsTitle")}
              </h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                {t(msgs, "prep.noGapsBody")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
      <ol className="space-y-3">
        {modules.map((m, i) => {
          const target = targets?.find((item) => item.module.id === m.id);
          return <li key={m.id}>
            <Card>
              <CardContent className="flex flex-col gap-4 py-5">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[12px] text-accent"
                  aria-hidden
                >
                  {i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-serif text-[17px] text-ink">
                      {m.title}
                    </h3>
                    {!target && <StatusChip state={m.status} />}
                  </div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                    {target ? `为什么练：${target.growth.join("；")}` : m.rationale}
                  </p>
                  {target && <>
                    <p className="mt-2 text-sm text-ink-soft">怎么练：{target.actions.join("；") || "先复盘卡片，再口述推理过程，由教练追问。"}</p>
                    <p className="mt-2 text-sm text-muted" aria-live="polite">
                      {target.material_status === "ready" ? `${target.cards.length} 张卡片已就绪`
                        : target.material_status === "pending" ? "正在准备练习题…" : target.error}
                    </p>
                    {target.material_status === "failed" && <Button variant="out" size="sm" disabled={busy}
                      className="mt-2" onClick={() => onRetry?.(m.id)}>重试此项</Button>}
                  </>}
                  <div className="mt-2 flex items-center gap-3 text-[12px] font-mono text-faint">
                    <span>{m.competency}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {m.est_min} {t(msgs, "prep.minutesUnit")}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/prep?${source}&module=${encodeURIComponent(m.id)}#cards`}
                    className={buttonClasses({ size: "sm" })}
                    aria-label={t(msgs, "prep.ariaStartModule").replace("{title}", m.title)}
                  >
                    {t(msgs, "prep.start")}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                  {sessionId && target?.material_status === "ready" && <Link prefetch={false}
                    href={`/interview/coach?${source}&module=${encodeURIComponent(m.id)}&version=${version}`}
                    className={buttonClasses({ size: "sm", variant: "out" })}>
                    让教练从此项开始
                  </Link>}
                  <Link
                    href={sessionId ? `/setup?source=${encodeURIComponent(sessionId)}&focus=${encodeURIComponent(m.competency)}` : "/setup"}
                    className={buttonClasses({ size: "sm", variant: "out" })}
                    aria-label={t(msgs, "prep.ariaPractice").replace("{skill}", m.competency)}
                  >
                    再面试，重点练此项
                  </Link>
                </div>
              </CardContent>
            </Card>
          </li>;
        })}
      </ol>
      )}
    </section>
  );
}
