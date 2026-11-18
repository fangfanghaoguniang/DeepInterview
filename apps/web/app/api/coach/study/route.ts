import { NextResponse } from "next/server";
import { z } from "zod";
import { StudyViewSchema } from "@deepinterview/shared";
import { loadStudy, studyRequest, StudyApiError } from "@/lib/study-api";

export const dynamic = "force-dynamic";
const Body = z.object({
  session_id: z.string().min(1).max(200),
  retry: z.boolean().default(false),
  module_id: z.string().max(200).optional(),
});
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof StudyApiError ? error.message : "学习数据格式异常" },
    { status: error instanceof StudyApiError ? error.status : 502 });
}
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("session");
  if (!id) return NextResponse.json({ error: "缺少面试编号" }, { status: 400 });
  try { return NextResponse.json(await loadStudy(id)); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
  try {
    const data = await studyRequest("/api/coach/study/prepare", { method: "POST", body: JSON.stringify(parsed.data) });
    return NextResponse.json(StudyViewSchema.parse(data));
  } catch (error) { return failure(error); }
}
