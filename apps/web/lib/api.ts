import {
  PrepResponseSchema,
  ScoreResponseSchema,
  StudyPlanSchema,
  type PrepRequest,
  type PrepResponse,
  type ScoreCard,
  type ScoreRequest,
  type ScoreResponse,
  type Language,
  type StudyPlan,
} from "@deepinterview/shared";
import { serverEnv } from "@/lib/env";

async function postJson<T>(
  path: string,
  body: unknown,
  parse: (data: unknown) => T,
): Promise<T> {
  const secret = serverEnv.internalApiSecret;
  const res = await fetch(`${serverEnv.agentApiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-internal-secret": secret } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Agent request ${path} failed: ${res.status} ${res.statusText}${
        text ? ` — ${text}` : ""
      }`,
    );
  }

  return parse(await res.json());
}

/** Kick off the prep pipeline for a CV + JD + company. */
export function requestPrep(body: PrepRequest): Promise<PrepResponse> {
  return postJson("/api/prep", body, (d) => PrepResponseSchema.parse(d));
}

/** Score a completed interview session. */
export function requestScore(body: ScoreRequest): Promise<ScoreResponse> {
  return postJson("/api/score", body, (d) => ScoreResponseSchema.parse(d));
}

/**
 * Build a Study Coach plan from a scorecard's growth items (server-side).
 * `language` sets the output language of the module text; omitted → the
 * backend's "en" default (legacy behavior). `sessionId` (when known) makes the
 * backend merge that session's persisted practice mastery into the module
 * statuses, so a re-visit shows what was already practiced.
 */
export function requestCoachPlan(
  scorecard: ScoreCard,
  language?: Language,
  sessionId?: string,
): Promise<StudyPlan> {
  return postJson(
    "/api/coach/plan",
    {
      scorecard,
      ...(language ? { language } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    },
    (d) => StudyPlanSchema.parse(d),
  );
}

/** A targeted practice question the coach generated for an overflow growth
 * competency, bundled with a reference answer (mirrors the agent's DrillItem). */
export interface CoachDrillItem {
  id: string;
  competency: string;
  text: Record<string, string>;
  answer: string;
}

/**
 * Fetch (and lazily generate) the targeted drills for ONE competency on a real
 * session. The backend is idempotent: a re-request returns the stored set with
 * no regeneration. Returns [] on any non-array shape (fail closed to no drills).
 */
export function requestCoachDrill(
  sessionId: string,
  competency: string,
  language?: Language,
): Promise<CoachDrillItem[]> {
  return postJson(
    "/api/coach/drill",
    { session_id: sessionId, competency, ...(language ? { language } : {}) },
    (d) => {
      const raw = (d as { items?: unknown }).items;
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (x): x is CoachDrillItem =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as { id?: unknown }).id === "string" &&
            typeof (x as { answer?: unknown }).answer === "string",
        )
        .map((x) => ({
          id: x.id,
          competency: x.competency,
          text: x.text ?? {},
          answer: x.answer,
        }));
    },
  );
}
