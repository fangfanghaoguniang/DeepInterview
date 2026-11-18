import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCoachToken, createInterviewToken, coachRoomName } from "../lib/livekit";

const KEYS = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_AGENT_NAME",
  "LIVEKIT_COACH_AGENT_NAME",
] as const;

const saved = new Map<string, string | undefined>();

function snapshot() {
  saved.clear();
  for (const k of KEYS) saved.set(k, process.env[k]);
}

function restore() {
  for (const k of KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function setLiveKitEnv(agentName?: string) {
  process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = "secretsecretsecretsecretsecretsecret";
  if (agentName === undefined) delete process.env.LIVEKIT_AGENT_NAME;
  else process.env.LIVEKIT_AGENT_NAME = agentName;
}

function decodePayload(jwt: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1] ?? "", "base64").toString(),
  ) as Record<string, unknown>;
}

afterEach(restore);

describe("createInterviewToken explicit agent dispatch (issue #67)", () => {
  it("requests the interviewer worker via roomConfig.agents with the session id", async () => {
    snapshot();
    setLiveKitEnv();

    const { token, url } = await createInterviewToken({
      room: "sess_123",
      identity: "dev-sess_123",
    });

    expect(url).toBe("wss://test.livekit.cloud");
    const payload = decodePayload(token);
    const roomConfig = payload.roomConfig as {
      agents: { agentName: string; metadata: string }[];
    };
    expect(roomConfig.agents).toHaveLength(1);
    // Default dispatch name — must match the worker's agent_name default.
    expect(roomConfig.agents[0]?.agentName).toBe("deepinterview-interviewer");
    expect(JSON.parse(roomConfig.agents[0]?.metadata ?? "{}")).toEqual({
      session_id: "sess_123",
    });
    // Room grant still pins the token to exactly this session's room.
    expect((payload.video as { room: string }).room).toBe("sess_123");
  });

  it("honors LIVEKIT_AGENT_NAME so web and worker stay in sync", async () => {
    snapshot();
    setLiveKitEnv("custom-interviewer");

    const { token } = await createInterviewToken({
      room: "sess_abc",
      identity: "user-1",
    });

    const payload = decodePayload(token);
    const roomConfig = payload.roomConfig as {
      agents: { agentName: string; metadata: string }[];
    };
    expect(roomConfig.agents[0]?.agentName).toBe("custom-interviewer");
    expect(JSON.parse(roomConfig.agents[0]?.metadata ?? "{}")).toEqual({
      session_id: "sess_abc",
    });
  });
});

describe("createCoachToken (spoken Socratic coach room)", () => {
  it("routes the COACH worker into a prefixed room with the raw session id", async () => {
    snapshot();
    setLiveKitEnv();

    const { token, url } = await createCoachToken({
      sessionId: "sess_123",
      identity: "coach-dev-sess_123",
    });

    expect(url).toBe("wss://test.livekit.cloud");
    const payload = decodePayload(token);
    // The room is prefixed — it can never be the live interview room itself.
    expect(coachRoomName("sess_123")).toBe("coach_sess_123");
    expect((payload.video as { room: string }).room).toBe("coach_sess_123");
    const roomConfig = payload.roomConfig as {
      agents: { agentName: string; metadata: string }[];
    };
    expect(roomConfig.agents).toHaveLength(1);
    // Default coach dispatch name — must match worker_coach's agent_name
    // default, and must NOT be the interviewer's name (job cross-routing).
    expect(roomConfig.agents[0]?.agentName).toBe("deepinterview-coach");
    // Metadata carries the RAW session id — worker_coach resolves the
    // InterviewContext from it, not by parsing the prefixed room name.
    expect(JSON.parse(roomConfig.agents[0]?.metadata ?? "{}")).toEqual({
      session_id: "sess_123",
    });
  });

  it("每轮使用独立房间，完整传递来源版本和起始目标", async () => {
    snapshot();
    setLiveKitEnv();
    const first = await createCoachToken({ sessionId: "sess_123", identity: "owner",
      runId: "run-first", version: "source-v1", entryModule: "goal-second" });
    const second = await createCoachToken({ sessionId: "sess_123", identity: "owner",
      runId: "run-second", version: "source-v1" });
    const payload = decodePayload(first.token);
    expect((payload.video as { room: string }).room).toBe("coach_sess_123_run-first");
    expect((decodePayload(second.token).video as { room: string }).room).toBe("coach_sess_123_run-second");
    const config = payload.roomConfig as { agents: { metadata: string }[] };
    expect(JSON.parse(config.agents[0]!.metadata)).toEqual({ session_id: "sess_123",
      run_id: "run-first", version: "source-v1", entry_module: "goal-second" });
    const defaultConfig = decodePayload(second.token).roomConfig as { agents: { metadata: string }[] };
    expect(JSON.parse(defaultConfig.agents[0]!.metadata).entry_module).toBeNull();
  });

  it("honors LIVEKIT_COACH_AGENT_NAME so web and coach worker stay in sync", async () => {
    snapshot();
    setLiveKitEnv();
    process.env.LIVEKIT_COACH_AGENT_NAME = "custom-coach";

    const { token } = await createCoachToken({
      sessionId: "sess_abc",
      identity: "user-1",
    });

    const payload = decodePayload(token);
    const roomConfig = payload.roomConfig as {
      agents: { agentName: string }[];
    };
    expect(roomConfig.agents[0]?.agentName).toBe("custom-coach");
  });
});
