import { NextResponse } from "next/server";
import { z } from "zod";
import { CoachRunSchema } from "@deepinterview/shared";
import { studyRequest, StudyApiError } from "@/lib/study-api";
import { createCoachToken } from "@/lib/livekit";
import { isLiveKitConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({
  session_id: z.string().min(1).max(200), version: z.string().min(1).max(100),
  run_id: z.string().uuid(), entry_module: z.string().max(200).nullable().default(null),
  action: z.enum(["start", "end"]),
});
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "练习参数无效" }, { status: 400 });
  const { action, ...body } = parsed.data;
  try {
    if (action === "start" && !isLiveKitConfigured()) throw new StudyApiError(503, "语音服务尚未配置，请返回备考页继续卡片练习");
    const run = CoachRunSchema.parse(await studyRequest(`/api/coach/run/${action}`, {
      method: "POST", body: JSON.stringify(body),
    }));
    if (action === "end") return NextResponse.json({ run });
    const user = await getUser();
    const token = await createCoachToken({ sessionId: body.session_id, runId: run.id,
      version: run.version, entryModule: run.entry_module, identity: user?.id ?? `learner-${run.id}` });
    return NextResponse.json({ run, ...token });
  } catch (error) {
    return NextResponse.json({ error: error instanceof StudyApiError ? error.message : "无法开始本轮教练练习" },
      { status: error instanceof StudyApiError ? error.status : 502 });
  }
}
