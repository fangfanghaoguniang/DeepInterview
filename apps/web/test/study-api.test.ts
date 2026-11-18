import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(async () => ({ id: "owner" })) }));
vi.mock("@deepinterview/ee", () => ({ gateRequest: vi.fn(() => ({ allow: true })) }));
vi.mock("@/lib/env", () => ({
  serverEnv: { agentApiUrl: "http://test-agent", internalApiSecret: "test-only" },
  isLiveKitConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/livekit", () => ({ createCoachToken: vi.fn(async () => ({ token: "test", url: "wss://test" })) }));

import { POST as chat } from "../app/api/coach/chat/route";
import { GET as readStudy, POST as prepareStudy } from "../app/api/coach/study/route";
import { POST as coachRun } from "../app/api/coach/run/route";
import { studyRequest } from "../lib/study-api";
import { getUser } from "../lib/supabase/server";
import { gateRequest } from "@deepinterview/ee";
import { createCoachToken } from "../lib/livekit";
import { isLiveKitConfigured } from "../lib/env";

const network = vi.fn<typeof fetch>();
const runId = "550e8400-e29b-41d4-a716-446655440000";
const view = { session_id: "s", version: "v", language: "zh", status: "empty", targets: [] };
const request = (body: unknown) => new Request("http://web/api/test", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("真实学习接口与预览边界", () => {
  it("只读 GET 不启动材料生成，空结果不变成示例", async () => {
    network.mockResolvedValueOnce(Response.json(view));
    const response = await readStudy(new Request("http://web/api/coach/study?session=s"));
    expect(response.status).toBe(200);
    expect((await response.json()).targets).toEqual([]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]?.[0]).toBe("http://test-agent/api/coach/study/s");
    expect(network.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("身份来自服务端，不接受浏览器冒充用户", async () => {
    network.mockResolvedValueOnce(Response.json(view));
    await prepareStudy(request({ session_id: "s", user_id: "other", retry: true, module_id: "goal" }));
    const options = network.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get("x-user-id")).toBe("owner");
    expect(new Headers(options?.headers).get("x-internal-secret")).toBe("test-only");
    expect(JSON.parse(options?.body as string)).toEqual({ session_id: "s", retry: true, module_id: "goal" });
  });

  it.each([403, 404, 409, 503])("透传上游 %i，不回落真实材料示例", async (status) => {
    network.mockResolvedValueOnce(Response.json({ detail: "读取失败" }, { status }));
    const response = await readStudy(new Request("http://web/api/coach/study?session=s"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "读取失败" });
  });

  it("网络错误、合同漂移和无效请求分别处理", async () => {
    network.mockRejectedValueOnce(new Error("离线"));
    expect((await readStudy(new Request("http://web/api/coach/study?session=s"))).status).toBe(503);
    network.mockResolvedValueOnce(Response.json({ targets: [] }));
    expect((await prepareStudy(request({ session_id: "s" }))).status).toBe(502);
    expect((await prepareStudy(request({ session_id: "" }))).status).toBe(400);
  });

  it("分发版本要求登录时不访问上游", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(null);
    vi.mocked(gateRequest).mockReturnValueOnce({ allow: false, reason: "unauthorized" } as ReturnType<typeof gateRequest>);
    await expect(studyRequest("/api/coach/study/s")).rejects.toMatchObject({ status: 401 });
    expect(network).not.toHaveBeenCalled();
  });

  it("示例聊天仅明确预览时使用，真实错误不会伪造回答", async () => {
    const preview = await chat(request({ session_id: "anonymous", query: "如何练习" }));
    expect((await preview.json()).answer).toContain("Sample response");
    expect(network).not.toHaveBeenCalled();
    network.mockRejectedValueOnce(new Error("离线"));
    const real = await chat(request({ session_id: "s", query: "如何练习" }));
    expect(real.status).toBe(503);
    expect(await real.json()).not.toHaveProperty("answer");
    network.mockResolvedValueOnce(Response.json({ wrong: true }));
    expect((await chat(request({ session_id: "s", query: "问题" }))).status).toBe(502);
  });
});

describe("教练轮次与令牌边界", () => {
  it("先确认授权运行，才生成携带版本和入口的令牌", async () => {
    network.mockResolvedValueOnce(Response.json({ id: runId, version: "v", entry_module: "goal",
      status: "running", started_at: 1, feedback: [] }));
    const response = await coachRun(request({ action: "start", session_id: "s", version: "v", run_id: runId, entry_module: "goal" }));
    expect(response.status).toBe(200);
    expect(createCoachToken).toHaveBeenCalledWith({ sessionId: "s", runId, version: "v", entryModule: "goal", identity: "owner" });
  });

  it("授权失败及未配置语音时不生成令牌", async () => {
    const body = { action: "start", session_id: "s", version: "v", run_id: runId };
    network.mockResolvedValueOnce(Response.json({ detail: "禁止访问" }, { status: 403 }));
    expect((await coachRun(request(body))).status).toBe(403);
    vi.mocked(isLiveKitConfigured).mockReturnValueOnce(false);
    expect((await coachRun(request(body))).status).toBe(503);
    expect(createCoachToken).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("结束只记录 pending，不由浏览器写掌握度", async () => {
    network.mockResolvedValueOnce(Response.json({ id: runId, version: "v", status: "pending", started_at: 1 }));
    const response = await coachRun(request({ action: "end", session_id: "s", version: "v", run_id: runId,
      feedback: [{ module_id: "goal", mastery: "mastered", note: "伪造反馈" }] }));
    expect(response.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty("feedback");
    expect(createCoachToken).not.toHaveBeenCalled();
  });
});
