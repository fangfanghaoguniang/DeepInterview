import { notFound } from "next/navigation";
import Link from "next/link";
import { loadStudy, StudyApiError } from "@/lib/study-api";
import { getPersona } from "@/lib/personas";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import { CoachLaunch } from "@/components/interview/coach-launch";

// Reads server-only config and the agent API per request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Spoken Socratic study-coach room (WP-4 voice sub-phase, wired). Server
 * component — mirrors the interview page's security shape exactly:
 *
 * Capability guard: the `?session=` id must name a REAL session with the
 * agent before any token is minted (fail-closed — same auth-free OSS design
 * as /interview/[id]). The LiveKit room is derived from the VERIFIED id
 * (`coach_<sessionId>`), never from a client-supplied room name, so a caller
 * cannot mint a token for an arbitrary room. The coach briefs itself from
 * that session's scorecard via `worker_coach`; a session without a scorecard
 * yet still works — the persona falls back to "which area do you want to
 * work on?" (see weak_areas_summary).
 *
 * Static segment: `/interview/coach` resolves to THIS page, not
 * `[id]` — Next gives static segments priority over dynamic ones.
 *
 * When LiveKit is unconfigured we pass `token=null` so <CoachRoom> renders
 * its honest preview shell — the offline path the build runs.
 */
export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[]; module?: string; version?: string }>;
}) {
  const params = await searchParams;
  const sessionId =
    typeof params.session === "string" && params.session
      ? params.session
      : null;
  if (!sessionId) notFound();

  const m = await getServerMessages();

  let study;
  try {
    study = await loadStudy(sessionId);
    if (params.version && params.version !== study.version) throw new Error("学习材料版本已变化，请从备考页重新进入。");
    if (!study.targets.some((target) => target.cards.length)) throw new Error("练习材料尚未就绪，请返回备考页查看状态。");
    if (params.module && !study.targets.some((target) => target.module.id === params.module && target.cards.length)) {
      throw new Error("起始目标不存在或材料未就绪。其他目标可从备考页进入。");
    }
  } catch (error) {
    return <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-serif text-2xl">暂时无法开始教练练习</h1>
      <p role="alert" className="my-4">{error instanceof Error ? error.message : "学习数据读取失败"}</p>
      <Link href={`/prep?session=${encodeURIComponent(sessionId)}`} className="text-accent underline">返回当前学习任务</Link>
    </main>;
  }

  // The coach shares the interviewer's avatar machinery but not its title —
  // the room frames itself as a coach, not a panel.
  const persona = { ...getPersona(undefined), name: t(m, "coach.title") };

  return (
    <CoachLaunch key={`${sessionId}:${study.version}:${params.module ?? "all"}`} study={study}
      entryModule={params.module ?? null} persona={persona} />
  );
}
