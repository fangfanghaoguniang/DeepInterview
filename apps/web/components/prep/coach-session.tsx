import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import type { CoachTurn } from "@/lib/session-read";

/**
 * "Last coaching session" replay for the prep page.
 *
 * The spoken Socratic session is captured by worker_coach into the session's
 * coach_transcript (a separate column from the interview transcript, so
 * neither can overwrite the other). This block surfaces the two signals that
 * matter for the study loop — how much was actually talked, and the coach's
 * closing synthesis — without dumping the raw dialog. Rendered ONLY when the
 * session has coaching turns: no turns, no block (the page hides the fact
 * the learner never coached rather than showing an empty card).
 */
export async function CoachSessionReplay({ turns }: { turns: CoachTurn[] }) {
  const m = await getServerMessages();
  const exchanges = turns.filter((tu) => tu.role === "user").length;
  if (exchanges === 0) return null;
  // The closing synthesis is the LAST assistant line the capture wrote —
  // wrap_up instructions tell the coach to deliver it as the final turn.
  const closing = [...turns]
    .reverse()
    .find((tu) => tu.role === "assistant" && tu.text.trim());

  return (
    <section className="mt-12">
      <Eyebrow>{t(m, "coach.replayEyebrow")}</Eyebrow>
      <h2 className="mt-2 font-serif text-2xl text-ink">
        {t(m, "coach.replayTitle")}
      </h2>
      <Card className="mt-4">
        <CardContent className="flex flex-col gap-4 py-6">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft"
              aria-hidden
            >
              <MessageSquare className="h-4 w-4 text-accent" />
            </span>
            <p className="text-[14px] text-ink">
              {t(m, "coach.replayRounds").replace(
                "{n}",
                String(exchanges),
              )}
            </p>
          </div>
          {closing ? (
            <div className="border-l-2 border-line pl-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-faint">
                {t(m, "coach.replayClosing")}
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                {closing.text}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
