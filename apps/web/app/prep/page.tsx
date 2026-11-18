import Link from "next/link";
import { RefreshCw, ArrowRight } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { LanguageToggle } from "@/components/language-toggle";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import { StudyWorkspace } from "@/components/prep/study-workspace";
import { SAMPLE_SCORECARD } from "@/lib/sample-scorecard";
import { SAMPLE_STUDY_PLAN } from "@/lib/sample-mastery";
import { StudyPlan } from "@/components/prep/study-plan";
import { GroundedChat } from "@/components/prep/grounded-chat";
import { Flashcards } from "@/components/prep/flashcards";
import { MasteryGraphView } from "@/components/prep/mastery-graph";
import { SocraticCta } from "@/components/prep/socratic-cta";

// Reads server-only config (`isSupabaseConfigured()`) and the per-request user;
// must not be statically prerendered.
export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ session?: string | string[]; module?: string | string[]; preview?: string; run?: string; feedback_error?: string }>;
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

  if (sessionId || params.preview !== "1") {
    return <main className="mx-auto max-w-[1100px] px-6 py-12">
      <header className="flex items-center justify-between"><Link href="/"><Eyebrow>DeepInterview</Eyebrow></Link><LanguageToggle /></header>
      <h1 className="mt-6 font-serif text-3xl text-ink sm:text-4xl">{t(m, "prep.pageTitle")}</h1>
      {sessionId ? <StudyWorkspace key={`${sessionId}:${params.run ?? "latest"}`} sessionId={sessionId} moduleId={moduleId}
              runId={typeof params.run === "string" ? params.run : null} feedbackError={params.feedback_error === "1"} />
        : <section className="mt-6 rounded-card border border-line p-6">
          <p>尚未关联面试。请从已生成的报告进入学习，或先完成一场模拟面试。</p>
          <div className="mt-4 flex flex-wrap gap-3"><Link href="/setup" className={buttonClasses()}>开始面试</Link>
            <Link href="/prep?preview=1" className={buttonClasses({ variant: "out" })}>查看示例</Link></div>
        </section>}
    </main>;
  }
  // 示例只在用户明确进入预览时展示，不发起模型请求。
  const isSample = true;
  const weakAreas = SAMPLE_SCORECARD.weak_competencies;
  const studyModules = SAMPLE_STUDY_PLAN;
  const activeStudyModule = studyModules.find((mo) => mo.id === moduleId) ?? null;

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
        <h1 className="font-serif text-3xl text-ink sm:text-4xl">{t(m, "prep.pageTitle")}</h1>
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
          mode="preview"
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
        <SocraticCta sessionId={null} />
      </section>

    </main>
  );
}
