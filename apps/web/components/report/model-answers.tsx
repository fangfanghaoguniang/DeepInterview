import type { ModelAnswer } from "@deepinterview/shared";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * "Better answer" cards. Each ModelAnswer is matched to its question text by
 * `question_id` via the provided lookup map; if a question is unknown we still
 * render the answer under its id. Frosted (paper) panels. Server component.
 */
export async function ModelAnswers({
  answers,
  questionText,
}: {
  answers: ModelAnswer[];
  /** question_id -> human question text */
  questionText: Record<string, string>;
}) {
  const m = await getServerMessages();
  if (answers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <Eyebrow>{t(m, "report.coachingEyebrow")}</Eyebrow>
        <CardTitle className="mt-1">{t(m, "report.modelTitle")}</CardTitle>
        <CardDescription>{t(m, "report.modelDesc")}</CardDescription>
      </CardHeader>
      <div className="space-y-3 px-6 pb-6">
        {answers.map((a, i) => (
          <div
            key={a.question_id + i}
            className="rounded-[10px] border border-line bg-paper/70 p-4 backdrop-blur-sm"
          >
            <p className="text-[13px] font-medium leading-snug text-ink">
              {questionText[a.question_id] ??
                t(m, "report.questionFallback").replace(
                  "{id}",
                  a.question_id,
                )}
            </p>
            <p className="mt-2 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-ink-soft">
              {a.answer}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
