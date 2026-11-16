import "server-only";

import { serverEnv } from "@/lib/env";
import { SessionViewSchema, type SessionView } from "@/lib/session";

/**
 * Server-only, fail-closed session read shared by the surfaces that gate
 * sensitive actions on a session EXISTING (minting a LiveKit interview token,
 * minting a coach token, the report page, the prep page's real-data path).
 *
 * Returns null on ANY miss — agent down, unknown session, shape drift, or a
 * session that hasn't been scored yet — so callers can degrade honestly
 * (preview / notFound / sample fallback) instead of throwing at request time.
 * Extracted verbatim from the per-page private copies so the security-
 * relevant fetch path has exactly one implementation.
 */
export async function loadSessionView(id: string): Promise<SessionView | null> {
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

/** One captured line of the spoken coaching transcript (worker_coach). */
export interface CoachTurn {
  role: string;
  text: string;
}

/**
 * Read the persisted SPOKEN coaching transcript for a session (GET
 * /api/coach/session/{id}) — same fail-closed discipline as loadSessionView:
 * agent down, unknown session or shape drift all collapse to null so the prep
 * page simply omits the replay block instead of erroring. Kept as its own
 * narrow read because the transcript deliberately does NOT ride on
 * SessionView (that view is the scoring/status read model).
 */
export async function loadCoachTranscript(id: string): Promise<CoachTurn[] | null> {
  try {
    const res = await fetch(
      `${serverEnv.agentApiUrl}/api/coach/session/${encodeURIComponent(id)}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return null;
    const raw = (data as { turns?: unknown }).turns;
    if (!Array.isArray(raw)) return null;
    // Permissive on role (the capture writes user/assistant today, but a
    // future role must not blank the whole block); strict on text.
    return raw
      .filter(
        (t): t is { role: string; text: string } =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as { text?: unknown }).text === "string" &&
          typeof (t as { role?: unknown }).role === "string",
      )
      .map((t) => ({ role: t.role, text: t.text }));
  } catch {
    return null;
  }
}
