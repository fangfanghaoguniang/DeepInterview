import Link from "next/link";
import { Mic, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

/**
 * Voice Socratic mode entry point. Links into the real coach room
 * (`/interview/coach?session=…`) which mints a LiveKit token for the coach
 * worker over THIS session's scorecard — the coach asks leading questions
 * instead of grading, reusing the interview's live voice loop.
 *
 * Only a REAL linked session can be coached (the briefing material comes
 * from its report), so on the sample-preview page the button is honestly
 * disabled with the reason — never a link that goes nowhere.
 */
export async function SocraticCta({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const m = await getServerMessages();
  return (
    <Card className="bg-ink text-white">
      <CardContent className="flex flex-col gap-5 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10"
            aria-hidden
          >
            <Mic className="h-5 w-5 text-white" />
          </span>
          <div>
            <Eyebrow className="text-white/60">
              {t(m, "prep.socraticEyebrow")}
            </Eyebrow>
            <h3 className="mt-1.5 font-serif text-xl text-white">
              {t(m, "prep.socraticTitle")}
            </h3>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-white/70">
              {t(m, "prep.socraticBody")}
            </p>
          </div>
        </div>

        {sessionId ? (
          <Link
            href={`/interview/coach?session=${encodeURIComponent(sessionId)}`}
            className="no-underline md:shrink-0"
          >
            <Button
              variant="out"
              className="border-white/30 bg-white/0 text-white hover:border-white hover:bg-white/10"
            >
              {t(m, "prep.socraticStart")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        ) : (
          <div className="flex flex-col items-start gap-1.5 md:items-end md:shrink-0">
            <Button
              variant="out"
              disabled
              aria-disabled
              className="border-white/30 bg-white/0 text-white/60"
            >
              {t(m, "prep.socraticStart")}
            </Button>
            <p className="max-w-xs text-[12px] leading-relaxed text-white/50">
              {t(m, "coach.needsSession")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
