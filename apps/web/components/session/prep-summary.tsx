"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  AlertTriangle,
  ExternalLink,
  RotateCw,
  ArrowRight,
} from "lucide-react";
import type {
  CandidateProfile,
  CompanyIntel,
  GapAnalysis,
  InterviewContext,
  JobSpec,
  QuestionPlan,
} from "@deepinterview/shared";
import {
  fetchSessionView,
  resetSessionPolling,
  PREP_STEPS,
  type ClientSessionView,
} from "@/lib/session";
import { cn } from "@/lib/cn";
import { t, type Dictionary } from "@/lib/i18n";
import { useMessages } from "@/lib/i18n/client";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const POLL_MS = 1200;

/** Statuses where prep is finished — stop polling. */
function isTerminal(status: ClientSessionView["status"]): boolean {
  return status !== "prep";
}

/** Header badge label per status (exhaustive, incl. client-side terminals). */
function statusBadge(m: Dictionary, status: ClientSessionView["status"]): string {
  switch (status) {
    case "prep":
      return t(m, "session.preparing");
    case "ready":
      return t(m, "session.ready");
    case "rejected":
      return t(m, "session.needsInput");
    case "error":
      return t(m, "session.error");
    case "complete":
    case "no_answers":
      return t(m, "session.complete");
    case "not_found":
      return t(m, "session.notFound");
    case "stalled":
      return t(m, "session.stalled");
  }
}

export function PrepSummary({
  sessionId,
  persona,
}: {
  sessionId: string;
  persona: string | null;
}) {
  const router = useRouter();
  const m = useMessages();
  const [view, setView] = useState<ClientSessionView | null>(null);
  // A nonce we bump to force a fresh poll cycle (used by the error Retry).
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const next = await fetchSessionView(sessionId);
      if (cancelled) return;
      setView(next);
      // Keep polling only while still preparing.
      if (!isTerminal(next.status)) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, retryKey]);

  const onRetry = useCallback(() => {
    // Restart the 404/deadline bookkeeping so the retry gets a fresh window.
    resetSessionPolling(sessionId);
    setView(null);
    setRetryKey((k) => k + 1);
  }, [sessionId]);

  const goSetup = useCallback(() => router.push("/setup"), [router]);
  const goInterview = useCallback(() => {
    const q = persona ? `?persona=${encodeURIComponent(persona)}` : "";
    router.push(`/interview/${sessionId}${q}`);
  }, [router, sessionId, persona]);

  const status = view?.status ?? "prep";
  const warnings = view?.prep_warnings ?? [];

  return (
    <main className="mx-auto max-w-[920px] px-6 py-12">
      <header className="flex items-center justify-between">
        <Eyebrow>DeepInterview</Eyebrow>
        <Badge variant="outline">{statusBadge(m, status)}</Badge>
      </header>

      {status === "prep" && (
        <PrepView progress={view?.progress ?? []} warnings={warnings} />
      )}

      {status === "ready" && view?.context && (
        <ReadyView
          context={view.context}
          warnings={warnings}
          onStart={goInterview}
          onBackToSetup={goSetup}
        />
      )}

      {/* Defensive: ready but no context parsed — treat as still preparing. */}
      {status === "ready" && !view?.context && (
        <PrepView progress={view?.progress ?? []} warnings={warnings} />
      )}

      {status === "rejected" && (
        <RejectedView warnings={warnings} onBackToSetup={goSetup} />
      )}

      {status === "error" && (
        <ErrorView onRetry={onRetry} onBackToSetup={goSetup} />
      )}

      {/* Polling deadline passed without a terminal status — honest stall. */}
      {status === "stalled" && (
        <ErrorView
          eyebrow={t(m, "session.stalledEyebrow")}
          title={t(m, "session.stalledTitle")}
          description={t(m, "session.stalledBody")}
          onRetry={onRetry}
          onBackToSetup={goSetup}
        />
      )}

      {/* Repeated 404s — this session genuinely doesn't exist. */}
      {status === "not_found" && (
        <ErrorView
          eyebrow={t(m, "session.nfEyebrow")}
          title={t(m, "session.nfTitle")}
          description={t(m, "session.nfBody")}
          onBackToSetup={goSetup}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Preparing — the agents working                                      */
/* ------------------------------------------------------------------ */

/** Notices shown above prep / bento — input-quality warnings from the agents. */
function WarningBanner({ warnings }: { warnings: string[] }) {
  const m = useMessages();
  if (warnings.length === 0) return null;
  return (
    <div className="mt-6 flex flex-col gap-2">
      {warnings.map((w, i) => (
        <p
          key={i}
          className="flex items-start gap-2 rounded-[10px] border border-line bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-accent"
            aria-hidden
          />
          <span>{t(m, "session.headsUp")} {w}</span>
        </p>
      ))}
    </div>
  );
}

/** PREP_STEPS key → dictionary sub-key under `session.prepStep*`. */
const PREP_STEP_LABEL_KEY: Record<string, string> = {
  cv_analysis: "Cv",
  jd_analysis: "Jd",
  company_research: "Company",
  gap_matching: "Fit",
  question_planner: "Plan",
};

function PrepView({
  progress,
  warnings,
}: {
  progress: string[];
  warnings: string[];
}) {
  const m = useMessages();
  const done = new Set(progress);
  const completed = PREP_STEPS.filter((s) => done.has(s.key)).length;
  const total = PREP_STEPS.length;
  // First step that isn't done yet — the one actively running.
  const active = PREP_STEPS.find((s) => !done.has(s.key));

  const stepLabel = (step: (typeof PREP_STEPS)[number]) =>
    t(m, `session.prepStep${PREP_STEP_LABEL_KEY[step.key] ?? ""}`).replace(
      "{company}",
      t(m, "session.theCompany"),
    );

  return (
    <div className="mt-8">
      <h1 className="serif text-3xl text-ink sm:text-4xl">
        {t(m, "session.prepTitle")}
      </h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
        {t(m, "session.prepBody")}
      </p>

      <WarningBanner warnings={warnings} />

      {/* Progress bar */}
      <div className="mt-8">
        <div className="flex items-center justify-between text-[12px] text-faint">
          <span className="font-mono uppercase tracking-[0.12em]">
            {t(m, "session.stepsOf").replace("{a}", String(completed)).replace("{b}", String(total))}
          </span>
          <span>{Math.round((completed / total) * 100)}%</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <Card className="mt-6">
        <CardContent className="flex flex-col gap-1 py-4">
          {PREP_STEPS.map((step) => {
            const isDone = done.has(step.key);
            const isActive = !isDone && active?.key === step.key;
            const label = stepLabel(step);
            return (
              <div
                key={step.key}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors",
                  isActive && "bg-accent-soft",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {isDone ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E8F3EC]">
                      <Check className="h-3 w-3 text-ok" aria-hidden />
                    </span>
                  ) : isActive ? (
                    <Spinner className="h-4 w-4 text-accent" label={label} />
                  ) : (
                    <span
                      className="h-2 w-2 rounded-full bg-line"
                      aria-hidden
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[14px]",
                    isDone
                      ? "text-ink-soft"
                      : isActive
                        ? "font-medium text-ink"
                        : "text-faint",
                  )}
                >
                  {label}
                </span>
                {isDone && (
                  <span className="ml-auto text-[11px] font-mono uppercase tracking-[0.1em] text-ok">
                    {t(m, "session.stepDone")}
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ready — the "what we found" bento                                   */
/* ------------------------------------------------------------------ */

/** A small chip row; trims to `max` with a "+N" overflow chip. */
function Chips({
  items,
  max = 12,
  variant = "outline",
}: {
  items: string[];
  max?: number;
  variant?: "outline" | "default" | "ok" | "accent";
}) {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  if (items.length === 0) {
    return <span className="text-[13px] text-faint">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((it, i) => (
        <Badge key={`${it}-${i}`} variant={variant} className="font-sans">
          {it}
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="outline" className="font-sans text-faint">
          +{extra}
        </Badge>
      )}
    </div>
  );
}

function BentoCard({
  eyebrow,
  title,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <Eyebrow>{eyebrow}</Eyebrow>
        <CardTitle className="text-[19px]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pb-6">
        {children}
      </CardContent>
    </Card>
  );
}

function CandidateCard({ c }: { c: CandidateProfile }) {
  const m = useMessages();
  return (
    <BentoCard
      eyebrow={t(m, "session.candidate")}
      title={c.name || t(m, "session.you")}
    >
      <p className="text-[14px] leading-relaxed text-ink-soft">{c.headline}</p>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Badge variant="default" className="font-sans capitalize">
          {c.seniority}
        </Badge>
        <span>
          {c.years_experience}{' '}
          {c.years_experience === 1
            ? t(m, "session.yearUnit")
            : t(m, "session.yearsUnit")}{" "}
          {t(m, "session.experienceWord")}
        </span>
      </div>
      <div className="mt-1">
        <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
          {t(m, "session.topSkills")}
        </p>
        <Chips items={c.skills} max={10} />
      </div>
    </BentoCard>
  );
}

function RoleCard({ j }: { j: JobSpec }) {
  const m = useMessages();
  return (
    <BentoCard
      eyebrow={t(m, "session.theRole")}
      title={j.title || t(m, "session.targetRole")}
      className="md:col-span-2"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
            {t(m, "session.mustHave")}
          </p>
          {j.must_have.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {j.must_have.slice(0, 6).map((m, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] leading-snug text-ink-soft"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent"
                    aria-hidden
                  />
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
            {t(m, "session.niceToHave")}
          </p>
          {j.nice_to_have.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {j.nice_to_have.slice(0, 6).map((m, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] leading-snug text-muted"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-line"
                    aria-hidden
                  />
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </div>
      </div>
      {j.tech_stack.length > 0 && (
        <div className="mt-1">
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
            {t(m, "session.techStack")}
          </p>
          <Chips items={j.tech_stack} max={12} />
        </div>
      )}
    </BentoCard>
  );
}

function CompanyCard({ co }: { co: CompanyIntel }) {
  const m = useMessages();
  const hasIntel = Boolean(co.summary) || co.citations.length > 0;
  return (
    <BentoCard
      eyebrow={t(m, "session.companyIntel")}
      title={co.name || t(m, "session.companyFallback")}
      className="md:col-span-2"
    >
      {hasIntel ? (
        <>
          {co.summary && (
            <p className="text-[14px] leading-relaxed text-ink-soft">
              {co.summary}
            </p>
          )}
          {co.industry && (
            <p className="text-[12px] text-muted">{co.industry}</p>
          )}
          {co.citations.length > 0 && (
            <div className="mt-1">
              <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
                {t(m, "session.sources")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {co.citations.slice(0, 6).map((cite, i) => (
                  <a
                    key={i}
                    href={cite.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={cite.snippet ?? cite.title}
                    className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[12px] text-ink-soft no-underline transition-colors hover:border-ink hover:no-underline"
                  >
                    <ExternalLink
                      className="h-3 w-3 shrink-0 text-faint"
                      aria-hidden
                    />
                    <span className="truncate">{cite.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">
          {t(m, "session.limitedIntel")}
        </p>
      )}
    </BentoCard>
  );
}

function FitCard({ g }: { g: GapAnalysis }) {
  const m = useMessages();
  return (
    <BentoCard
      eyebrow={t(m, "session.yourFit")}
      title={t(m, "session.whereYouMatch")}
      className="md:col-span-2"
    >
      {g.summary && (
        <p className="text-[14px] leading-relaxed text-ink-soft">{g.summary}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-ok">
            {t(m, "session.strengths")}
          </p>
          {g.strengths.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {g.strengths.slice(0, 5).map((s, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] leading-snug text-ink-soft"
                >
                  <Check
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok"
                    aria-hidden
                  />
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-accent">
            {t(m, "session.gapsToProbe")}
          </p>
          {g.gaps.length > 0 || g.probe_targets.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {[...g.gaps, ...g.probe_targets].slice(0, 5).map((s, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] leading-snug text-ink-soft"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                    aria-hidden
                  />
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </div>
      </div>
      {g.matched_skills.length > 0 && (
        <div className="mt-1">
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
            {t(m, "session.matchedSkills")}
          </p>
          <Chips items={g.matched_skills} max={10} variant="ok" />
        </div>
      )}
    </BentoCard>
  );
}

/** Question-plan section keys → dictionary sub-keys under `session.sec*`. */
const SECTION_LABEL_KEY: Record<string, string> = {
  intro: "session.secIntro",
  behavioral: "session.secBehavioral",
  technical: "session.secTechnical",
  coding: "session.secCoding",
  wrap: "session.secWrap",
};

function PlanCard({ p }: { p: QuestionPlan }) {
  const m = useMessages();
  // Difficulty spread (1–5-ish). Build buckets without unchecked indexing.
  const counts = new Map<number, number>();
  for (const q of p.questions) {
    counts.set(q.difficulty, (counts.get(q.difficulty) ?? 0) + 1);
  }
  const maxCount = Math.max(1, ...Array.from(counts.values()));
  const levels = Array.from(counts.keys()).sort((a, b) => a - b);

  return (
    <BentoCard
      eyebrow={t(m, "session.interviewPlan")}
      title={t(m, "session.planCount")
        .replace("{n}", String(p.questions.length))
        .replace("{min}", String(p.time_budget_min))}
      className="md:col-span-2"
    >
      <div>
        <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
          {t(m, "session.flow")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {p.sections_order.map((s, i) => (
            <span
              key={`${s}-${i}`}
              className="inline-flex items-center rounded-full border border-line bg-paper px-2.5 py-1 text-[12px] text-ink-soft"
            >
              {SECTION_LABEL_KEY[s]
                ? t(m, SECTION_LABEL_KEY[s])
                : s}
            </span>
          ))}
        </div>
      </div>
      {levels.length > 0 && (
        <div className="mt-1">
          <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
            {t(m, "session.difficultySpread")}
          </p>
          <div className="flex items-end gap-2">
            {levels.map((lvl) => {
              const n = counts.get(lvl) ?? 0;
              return (
                <div key={lvl} className="flex flex-col items-center gap-1">
                  <div className="flex h-12 items-end">
                    <div
                      className="w-6 rounded-t bg-accent-soft"
                      style={{
                        height: `${Math.max(8, (n / maxCount) * 100)}%`,
                      }}
                    >
                      <div className="h-1 w-full rounded-t bg-accent" />
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-faint">
                    L{lvl}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </BentoCard>
  );
}

function ReadyView({
  context,
  warnings,
  onStart,
  onBackToSetup,
}: {
  context: InterviewContext;
  warnings: string[];
  onStart: () => void;
  onBackToSetup: () => void;
}) {
  const m = useMessages();
  return (
    <div className="mt-8">
      <h1 className="serif text-3xl text-ink sm:text-4xl">
        {t(m, "session.whatWeFound")}
      </h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
        {t(m, "session.tailoringLead")}{" "}
        <span className="text-ink-soft">
          {context.job.title || t(m, "session.theRoleFallback")}
        </span>
        {context.job.company_name ? (
          <>
            {" "}
            {t(m, "session.tailoringAt")}{" "}
            <span className="text-ink-soft">{context.job.company_name}</span>
          </>
        ) : null}
        .
      </p>

      <WarningBanner warnings={warnings} />

      {/* Bento grid */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <CandidateCard c={context.candidate} />
        <RoleCard j={context.job} />
        <CompanyCard co={context.company} />
        <FitCard g={context.gap} />
        <PlanCard p={context.plan} />
      </div>

      {/* CTA */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onStart}>
          {t(m, "session.startInterview")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="out" size="lg" onClick={onBackToSetup}>
          {t(m, "session.backToSetup")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rejected — friendly empty state                                     */
/* ------------------------------------------------------------------ */

function RejectedView({
  warnings,
  onBackToSetup,
}: {
  warnings: string[];
  onBackToSetup: () => void;
}) {
  const m = useMessages();
  return (
    <div className="mx-auto mt-10 max-w-[560px]">
      <Card>
        <CardHeader>
          <Eyebrow>{t(m, "session.rejectedEyebrow")}</Eyebrow>
          <CardTitle className="serif text-2xl">
            {t(m, "session.rejectedTitle")}
          </CardTitle>
          <CardDescription>{t(m, "session.rejectedBody")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pb-6">
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-2">
              {warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-soft"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                    aria-hidden
                  />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-[10px] border border-line bg-paper px-4 py-3">
            <p className="mb-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-faint">
              {t(m, "session.tips")}
            </p>
            <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted">
              <li>{t(m, "session.tip1")}</li>
              <li>{t(m, "session.tip2")}</li>
              <li>{t(m, "session.tip3")}</li>
            </ul>
          </div>

          <Button size="lg" className="self-start" onClick={onBackToSetup}>
            {t(m, "session.backToSetup")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Error — generic recoverable failure (also stalled / not-found copy) */
/* ------------------------------------------------------------------ */

function ErrorView({
  eyebrow,
  title,
  description,
  onRetry,
  onBackToSetup,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Omit to hide the Retry button (e.g. a session that doesn't exist). */
  onRetry?: () => void;
  onBackToSetup: () => void;
}) {
  const m = useMessages();
  return (
    <div className="mx-auto mt-10 max-w-[520px]">
      <Card>
        <CardHeader>
          <Eyebrow>{eyebrow ?? t(m, "session.errEyebrow")}</Eyebrow>
          <CardTitle className="serif text-2xl">
            {title ?? t(m, "session.errTitle")}
          </CardTitle>
          <CardDescription>
            {description ?? t(m, "session.errBody")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 pb-6">
          {onRetry && (
            <Button size="lg" onClick={onRetry}>
              <RotateCw className="h-4 w-4" aria-hidden />
              {t(m, "session.retry")}
            </Button>
          )}
          <Button variant="out" size="lg" onClick={onBackToSetup}>
            {t(m, "session.backToSetup")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
