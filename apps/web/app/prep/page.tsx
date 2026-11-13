import Link from "next/link";
import { RefreshCw, ArrowRight } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { LanguageToggle } from "@/components/language-toggle";
import { t } from "@/lib/i18n";
import { getServerLocale, getServerMessages } from "@/lib/i18n/server";
import type { StudyModule } from "@deepinterview/shared";
import { serverEnv } from "@/lib/env";
import { SessionViewSchema, type SessionView } from "@/lib/session";
import { buildStudyCards } from "@/lib/prep-filter";
import { SAMPLE_SCORECARD } from "@/lib/sample-scorecard";
import { SAMPLE_STUDY_PLAN } from "@/lib/sample-mastery";
import { requestCoachPlan } from "@/lib/api";
import { StudyPlan } from "@/components/prep/study-plan";
import { GroundedChat } from "@/components/prep/grounded-chat";
import { Flashcards } from "@/components/prep/flashcards";
import { MasteryGraphView } from "@/components/prep/mastery-graph";
import { SocraticCta } from "@/components/prep/socratic-cta";

// Reads server-only config (`isSupabaseConfigured()`) and the per-request user;
// must not be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Fetch a session's real scorecard from the agent API (same pattern as the
 * report page's `load()`). Returns null on ANY miss — agent down, unknown
 * session, shape drift, or a session that hasn't been scored yet — so the
 * caller can fall back honestly.
 */
async function loadSessionView(id: string): Promise<SessionView | null> {
  try {
    const res = await fetch(
      `${serverEnv.agentApiUrl}/api/session/${encodeURIComponent(id)}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const parsed = SessionViewSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Prep Coach (WP-4). The closed-loop study surface: it turns the last
 * interview's `weak_competencies` into an ordered study plan, a grounded RAG
 * chat, a spaced-repetition deck, a mastery graph, and a voice Socratic mode —
 * then loops the learner back into a new mock.
 *
 * Server shell: auth-gates only when Supabase is configured (offline it
 * proceeds), then composes the client islands. The report's "Coach me" CTA
 * links here with `?session=`, so the plan is built from THAT interview's real
 * scorecard; the sample card is ONLY the no-session (or lookup-miss) fallback,
 * and is labeled as a preview.
 */
export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[]; module?: string | string[] }>;
}) {
  // No auth gate — OSS runs without sign-in.
  const m = await getServerMessages();
  const params = await searchParams;
  const sessionId =
    typeof params.session === "string" && params.session
      ? params.session
      : null;
  // "Start studying" links point here: /prep?module=<id>. Resolve it against
  // the SAME module list StudyPlan renders (real coach plan when present,
  // sample deck otherwise) so the flashcards can filter to that module.
  const moduleId =
    typeof params.module === "string" && params.module
      ? params.module
      : null;

  // Weak areas come from the linked interview's real scorecard when present;
  // otherwise fall back to the clearly-labeled sample.
  const view = sessionId ? await loadSessionView(sessionId) : null;
  const real = view?.scorecard ?? null;
  const scorecard = real ?? SAMPLE_SCORECARD;
  const isSample = real === null;
  const weakAreas = scorecard.weak_competencies;

  // Build the real study plan from the scorecard via the coach agent. Falls back
  // to the StudyPlan component's sample modules if the agent is unreachable.
  // Module text follows the INTERVIEW language when a real session is linked;
  // with the sample scorecard there is no interview language, so the UI locale
  // stands in — a Chinese-interface visitor gets a Chinese plan.
  const planLanguage = view?.context
    ? view.context.plan.language_mode.primary
    : await getServerLocale();
  let studyModules: StudyModule[] | undefined;
  try {
    const plan = await requestCoachPlan(scorecard, planLanguage);
    if (plan.modules.length > 0) studyModules = plan.modules;
  } catch {
    // Agent down / offline dev — StudyPlan renders its default sample modules.
  }

  const moduleList = studyModules ?? SAMPLE_STUDY_PLAN;
  const activeStudyModule = moduleId
    ? moduleList.find((mo) => mo.id === moduleId) ?? null
    : null;

  // Real review deck: the interview's own weak-area questions paired with the
  // model answers the post pipeline wrote into the scorecard. Empty (no
  // session, unscored, or no model answers yet) → Flashcards keeps its sample
  // deck, consistent with the "preview data" badge above.
  const realCards =
    view?.context && real
      ? buildStudyCards(
          view.context.plan.questions,
          real.model_answers,
          real.weak_competencies,
          view.context.plan.language_mode.primary,
        )
      : [];

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-12">
      {/* Header */}
      <header className="flex items-center justify-between">
        <Link href="/" className="no-underline">
          <Eyebrow>DeepInterview</Eyebrow>
        </Link>
        <div className="flex items-center gap-3">
          {isSample && <Badge variant="outline">{t(m, "prep.pageBadgePreview")}</Badge>}
          <LanguageToggle />
        </div>
      </header>

      <div className="mt-6">
        <h1 className="font-serif text-4xl text-ink">{t(m, "prep.pageTitle")}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          {isSample
            ? t(m, "prep.pageIntroSample")
            : t(m, "prep.pageIntroReal")}
        </p>
      </div>

      {/* Loop-back banner */}
      <section className="mt-6">
        <div className="flex flex-col items-start gap-4 rounded-card border border-line bg-accent-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <RefreshCw
              className="mt-0.5 h-5 w-5 shrink-0 text-accent"
              aria-hidden
            />
            <div>
              <h2 className="font-serif text-lg text-ink">
                {t(m, "prep.loopTitle")}
              </h2>
              <p className="mt-0.5 text-[13.5px] text-muted">
                {t(m, "prep.loopBody")}
              </p>
            </div>
          </div>
          <Link
            href="/setup"
            className={buttonClasses({ className: "sm:shrink-0" })}
          >
            {t(m, "prep.loopCta")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      {/* Study plan + grounded chat side by side on wide screens */}
      <section className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_1fr]">
        <StudyPlan modules={studyModules} weakAreas={weakAreas} />
        <GroundedChat sessionId={sessionId} />
      </section>

      {/* Flashcards + mastery graph */}
      <section className="mt-12 grid gap-10 lg:grid-cols-2">
        <Flashcards
          cards={realCards.length > 0 ? realCards : undefined}
          activeModule={
            activeStudyModule
              ? { title: activeStudyModule.title, competency: activeStudyModule.competency }
              : null
          }
        />
        <MasteryGraphView />
      </section>

      {/* Voice Socratic mode */}
      <section className="mt-12">
        <SocraticCta />
      </section>
    </main>
  );
}
