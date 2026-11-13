"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMessages } from "@/lib/i18n/client";
import { selectVisibleCards, type ActiveModuleInfo } from "@/lib/prep-filter";
import {
  newCard,
  schedule,
  isDue,
  previewInterval,
  type Rating,
  type SrsState,
} from "@/lib/srs";
import { SAMPLE_FLASHCARDS, type Flashcard } from "@/lib/sample-mastery";

const RATINGS: { rating: Rating; labelKey: string; variant: "out" | "ink" }[] =
  [
    { rating: "again", labelKey: "prep.again", variant: "out" },
    { rating: "hard", labelKey: "prep.hard", variant: "out" },
    { rating: "good", labelKey: "prep.good", variant: "out" },
    { rating: "easy", labelKey: "prep.easy", variant: "ink" },
  ];

/**
 * Spaced-repetition review. Cards flip (front → back) via a CSS 3D transform —
 * no `motion` dependency. Rating a card runs the inline FSRS-like (SM-2)
 * scheduler in `lib/srs.ts` and advances to the next still-due card.
 *
 * Scheduler state lives in `useState`, seeded inside the initializer so the
 * clock is read on the client only (SSR-safe, no hydration mismatch).
 */
export function Flashcards({
  cards = SAMPLE_FLASHCARDS,
  activeModule = null,
}: {
  cards?: Flashcard[];
  /** Set from /prep?module=<id> — filters the deck to one study module. */
  activeModule?: ActiveModuleInfo | null;
}) {
  const messages = useMessages();
  const sectionRef = useRef<HTMLElement>(null);
  // "End filter" / "use full deck" — a local escape hatch over the URL filter.
  const [dismissed, setDismissed] = useState(false);

  // The deck the session actually walks: full pool, or one module's slice.
  const visible = useMemo(
    () => selectVisibleCards(cards, activeModule, dismissed),
    [cards, activeModule, dismissed],
  );

  // React to a module switch (or a fresh link after dismissing): re-arm the
  // filter and restart the walk from the first card of the new slice.
  useEffect(() => {
    setDismissed(false);
    setIndex(0);
    setFlipped(false);
  }, [activeModule?.competency]);
  // Seed per-card SRS state once, on the client, off a single `now`.
  const [states, setStates] = useState<Record<string, SrsState>>(() => {
    const now = Date.now();
    const seed: Record<string, SrsState> = {};
    for (const c of cards) seed[c.id] = newCard(now);
    return seed;
  });
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedThisSession, setReviewedThisSession] = useState(0);

  // Cards still due "right now" (computed off the same instant we render).
  const now = Date.now();
  const dueIds = useMemo(
    () =>
      visible
        .filter((c) => isDue(states[c.id] ?? newCard(now), now))
        .map((c) => c.id),
    [visible, states, now],
  );

  const current = visible[index];
  const allDone = dueIds.length === 0;
  // Filtered to a module that owns no cards (real coach plans can name
  // competencies the sample deck never covers).
  const emptyModule = visible.length === 0;

  function rate(rating: Rating) {
    if (!current) return;
    const at = Date.now();
    const prev = states[current.id] ?? newCard(at);
    setStates((s) => ({ ...s, [current.id]: schedule(prev, rating, at) }));
    setReviewedThisSession((n) => n + 1);
    setFlipped(false);

    // Advance to the next card that is still due after this rating.
    const order = visible.map((c) => c.id);
    const start = (index + 1) % visible.length;
    for (let step = 0; step < visible.length; step++) {
      const i = (start + step) % visible.length;
      const id = order[i];
      if (!id) continue;
      // The card we just rated is no longer due (we pushed it into the future).
      const st =
        id === current.id
          ? schedule(prev, rating, at)
          : (states[id] ?? newCard(at));
      if (isDue(st, at)) {
        setIndex(i);
        return;
      }
    }
    // None left due — park on the current index; the "all caught up" state shows.
    setIndex(index);
  }

  function resetSession() {
    const at = Date.now();
    const seed: Record<string, SrsState> = {};
    for (const c of cards) seed[c.id] = newCard(at);
    setStates(seed);
    setIndex(0);
    setFlipped(false);
    setReviewedThisSession(0);
  }

  const total = visible.length;
  const dueCount = dueIds.length;
  const progressPct =
    total > 0 ? Math.round(((total - dueCount) / total) * 100) : 0;

  // Jump the reader down to the deck whenever a module filter (re)applies —
  // including a direct page load of /prep?module=<id>.
  useEffect(() => {
    if (activeModule) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeModule]);

  return (
    <section ref={sectionRef} aria-labelledby="flashcards-heading">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <Eyebrow>{t(messages, "prep.cardsEyebrow")}</Eyebrow>
          <h2
            id="flashcards-heading"
            className="mt-2 font-serif text-2xl text-ink"
          >
            {t(messages, "prep.cardsTitle")}
          </h2>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px] text-ink-soft">
            {t(messages, "prep.cardsDue").replace("{n}", String(dueCount))}
          </p>
          <p className="font-mono text-[11px] text-faint">
            {t(messages, "prep.cardsReviewed").replace(
              "{n}",
              String(reviewedThisSession),
            )}
          </p>
        </div>
      </header>

      {/* Study-session banner: which module we're drilling, with the escape
          hatch back to the full deck. Hidden once the filter is dismissed. */}
      {activeModule && !dismissed && visible.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-accent/25 bg-accent-soft px-4 py-2.5">
          <p className="text-[13.5px] text-ink-soft">
            {allDone
              ? t(messages, "prep.studyBannerDone")
              : t(messages, "prep.studyBanner")
                  .replace("{title}", activeModule.title)
                  .replace("{n}", String(visible.length))}
          </p>
          <Button
            variant="out"
            size="sm"
            onClick={() => setDismissed(true)}
          >
            {t(messages, "prep.endStudyFilter")}
          </Button>
        </div>
      )}

      {/* Progress bar */}
      <div
        className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t(messages, "prep.ariaReviewProgress")}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {activeModule && !dismissed && emptyModule ? (
        // Module selected but the deck has no cards for it — honest fallback
        // instead of an empty flip area.
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <h3 className="font-serif text-xl text-ink">
              {t(messages, "prep.noModuleCards")}
            </h3>
            <Button
              variant="out"
              size="sm"
              onClick={() => setDismissed(true)}
              className="mt-1"
            >
              {t(messages, "prep.useAllCards")}
            </Button>
          </CardContent>
        </Card>
      ) : allDone || !current ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f3ec]">
              <Check className="h-6 w-6 text-ok" aria-hidden />
            </span>
            <h3 className="font-serif text-xl text-ink">
              {t(messages, "prep.cardsAllDone")}
            </h3>
            <p className="max-w-sm text-[14px] leading-relaxed text-muted">
              {t(messages, "prep.cardsAllDoneBody")}
            </p>
            <Button
              variant="out"
              size="sm"
              onClick={resetSession}
              className="mt-1"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t(messages, "prep.cardsReset")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Flip card. CSS 3D transform — no animation library. */}
          <div
            className="[perspective:1600px]"
            role="button"
            tabIndex={0}
            aria-label={flipped
              ? t(messages, "prep.ariaShowQuestion")
              : t(messages, "prep.ariaRevealAnswer")}
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFlipped((f) => !f);
              }
            }}
          >
            <div
              className="relative min-h-[220px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
              style={{
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* Front */}
              <div className="absolute inset-0 [backface-visibility:hidden]">
                <Card className="flex h-full min-h-[220px] flex-col">
                  <CardContent className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                      {current.competency}
                    </span>
                    <p className="max-w-md font-serif text-[20px] leading-snug text-ink">
                      {current.front}
                    </p>
                    <span className="mt-2 text-[12px] text-faint">
                      {t(messages, "prep.cardsTapReveal")}
                    </span>
                  </CardContent>
                </Card>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 [backface-visibility:hidden]"
                style={{ transform: "rotateY(180deg)" }}
              >
                <Card className="flex h-full min-h-[220px] flex-col bg-accent-soft">
                  <CardContent className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
                      {t(messages, "prep.cardsAnswer")}
                    </span>
                    <p className="max-w-lg text-[15px] leading-relaxed text-ink-soft">
                      {current.back}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* Rating row — only meaningful once the answer is shown. */}
          <div
            className={cn(
              "mt-4 grid grid-cols-4 gap-2 transition-opacity duration-200",
              flipped ? "opacity-100" : "pointer-events-none opacity-40",
            )}
          >
            {RATINGS.map(({ rating, labelKey, variant }) => {
              const st = states[current.id] ?? newCard(now);
              return (
                <Button
                  key={rating}
                  variant={variant}
                  size="sm"
                  onClick={() => rate(rating)}
                  disabled={!flipped}
                  className="flex-col gap-0.5 py-2"
                >
                  <span>{t(messages, labelKey)}</span>
                  <span className="font-mono text-[10px] opacity-70">
                    {previewInterval(st, rating, now)}
                  </span>
                </Button>
              );
            })}
          </div>
          <p className="mt-2 text-center font-mono text-[11px] text-faint">
            {t(messages, "prep.cardsSchedulerNote")}
          </p>
        </>
      )}
    </section>
  );
}
