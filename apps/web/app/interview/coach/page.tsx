import { notFound } from "next/navigation";
import {
  isLiveKitConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { createCoachToken } from "@/lib/livekit";
import { loadSessionView } from "@/lib/session-read";
import { getPersona } from "@/lib/personas";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";
import { CoachRoom } from "@/components/interview/coach-room";

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
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionId =
    typeof params.session === "string" && params.session
      ? params.session
      : null;
  if (!sessionId) notFound();

  const m = await getServerMessages();

  const view = await loadSessionView(sessionId);
  if (!view || view.session_id !== sessionId) notFound();

  let identity = `coach-dev-${sessionId}`;
  let name: string | undefined;

  // No auth gate (OSS): anonymous visitors join with a session-scoped dev
  // identity; signed-in hosted users keep their real one (same as interview).
  if (isSupabaseConfigured()) {
    const user = await getUser();
    if (user) {
      identity = user.id;
      name =
        (user.user_metadata?.name as string | undefined) ??
        user.email ??
        undefined;
    }
  }

  let token: string | null = null;
  let url: string | null = null;
  if (isLiveKitConfigured()) {
    const minted = await createCoachToken({ sessionId, identity, name });
    token = minted.token;
    url = minted.url;
  }

  // The coach shares the interviewer's avatar machinery but not its title —
  // the room frames itself as a coach, not a panel.
  const persona = { ...getPersona(undefined), name: t(m, "coach.title") };

  return (
    <CoachRoom sessionId={sessionId} persona={persona} token={token} url={url} />
  );
}
