import "server-only";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";
import { isLiveKitConfigured, serverEnv } from "@/lib/env";

export interface CreateInterviewTokenArgs {
  /** LiveKit room name — we use the interview session id. */
  room: string;
  /** Participant identity (e.g. the user id, or a dev identity offline). */
  identity: string;
  /** Optional display name. */
  name?: string;
  /** Optional JSON-serializable metadata attached to the participant. */
  metadata?: Record<string, unknown>;
}

export interface InterviewToken {
  token: string;
  url: string;
}

/**
 * Mint a LiveKit access token granting a participant join+publish in `room`.
 *
 * The token carries an EXPLICIT agent dispatch (`roomConfig.agents`): the
 * voice worker registers under `LIVEKIT_AGENT_NAME` and LiveKit Cloud Agents
 * only routes a job to it when the token requests it. Without this the room
 * joins fine with no agent listening — the exact "Connecting your
 * interviewer…" hang in issue #67. The dispatch metadata carries the
 * session id so the worker can resolve its InterviewContext even when room
 * metadata is absent.
 *
 * Throws a clear error when LiveKit is not configured — call only behind an
 * `isLiveKitConfigured()` check (the token route does this). Never throws at import.
 */
export async function createInterviewToken({
  room,
  identity,
  name,
  metadata,
}: CreateInterviewTokenArgs): Promise<InterviewToken> {
  if (!isLiveKitConfigured()) {
    throw new Error(
      "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
    );
  }

  const at = new AccessToken(
    serverEnv.livekitApiKey,
    serverEnv.livekitApiSecret,
    {
      identity,
      name,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  );

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Explicit dispatch: route the interviewer worker into THIS room. `room`
  // IS the session id (interview page pins room = verified session id), and
  // the metadata lets the worker resolve it without depending on room
  // metadata being set. `livekitAgentName` must match the worker's
  // `agent_name` (LIVEKIT_AGENT_NAME) or the dispatch matches nothing.
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: serverEnv.livekitAgentName,
        metadata: JSON.stringify({ session_id: room }),
      }),
    ],
  });

  const token = await at.toJwt();
  return { token, url: serverEnv.livekitUrl as string };
}

/**
 * LiveKit room name for a session's SPOKEN COACH room. Prefixed so it can
 * never collide with the interview room (which IS the bare session id) — the
 * coach for a live interview runs in its own room, its own agent.
 */
export function coachRoomName(sessionId: string, runId?: string): string {
  return `coach_${sessionId}${runId ? `_${runId}` : ""}`;
}

export interface CreateCoachTokenArgs {
  /** The INTERVIEW session the coach briefs itself from (capability handle). */
  sessionId: string;
  runId?: string;
  version?: string;
  entryModule?: string | null;
  identity: string;
  name?: string;
}

/**
 * Mint a token for the spoken study-coach room of one verified session.
 *
 * Same explicit-dispatch shape as `createInterviewToken` (issue #67 lesson),
 * except: the room is the prefixed `coach_<sessionId>` (so it never shares a
 * room with the live interview), the dispatch requests the COACH worker's
 * name, and the metadata still carries the raw session id — `worker_coach`
 * resolves its InterviewContext from that, not from the room name.
 */
export async function createCoachToken({
  sessionId, runId, version, entryModule,
  identity,
  name,
}: CreateCoachTokenArgs): Promise<InterviewToken> {
  if (!isLiveKitConfigured()) {
    throw new Error(
      "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
    );
  }

  const room = coachRoomName(sessionId, runId);
  const at = new AccessToken(
    serverEnv.livekitApiKey,
    serverEnv.livekitApiSecret,
    { identity, name },
  );

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: serverEnv.livekitCoachAgentName,
        metadata: JSON.stringify({ session_id: sessionId,
          ...(runId ? { run_id: runId, version, entry_module: entryModule ?? null } : {}),
        }),
      }),
    ],
  });

  const token = await at.toJwt();
  return { token, url: serverEnv.livekitUrl as string };
}
