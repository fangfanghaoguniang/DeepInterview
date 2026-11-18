import "server-only";

import { gateRequest } from "@deepinterview/ee";
import { StudyViewSchema } from "@deepinterview/shared";
import { serverEnv } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";

export class StudyApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 身份由服务端 cookie 确定，绝不信任浏览器传来的 user_id。 */
export async function studyRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const user = await getUser();
  const gate = gateRequest({ pathname: "/api/coach/study", isAuthenticated: Boolean(user) });
  if (!gate.allow) throw new StudyApiError(401, "请先登录");
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (serverEnv.internalApiSecret) headers.set("x-internal-secret", serverEnv.internalApiSecret);
  if (user) headers.set("x-user-id", user.id);
  let res: Response;
  try {
    res = await fetch(`${serverEnv.agentApiUrl}${path}`, {
      ...init, headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StudyApiError(503, "学习服务暂不可用，请稍后重试");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new StudyApiError(res.status, typeof body?.detail === "string" ? body.detail : "学习服务读取失败");
  }
  return res.json();
}

export async function loadStudy(sessionId: string) {
  return StudyViewSchema.parse(await studyRequest(`/api/coach/study/${encodeURIComponent(sessionId)}`));
}
