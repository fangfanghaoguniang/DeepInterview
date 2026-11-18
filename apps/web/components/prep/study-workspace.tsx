"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyViewSchema, type StudyView } from "@deepinterview/shared";
import { Button, buttonClasses } from "@/components/ui/button";
import { StudyPlan } from "./study-plan";
import { Flashcards } from "./flashcards";
import { GroundedChat } from "./grounded-chat";

export function StudyWorkspace({ sessionId, moduleId, runId = null, feedbackError = false }: {
  sessionId: string; moduleId: string | null; runId?: string | null; feedbackError?: boolean;
}) {
  const [study, setStudy] = useState<StudyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{ nonce: number; retry?: boolean; module_id?: string }>({ nonce: 0 });
  const source = `session=${encodeURIComponent(sessionId)}`;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPrepare = 0;
    let first = true;
    async function fetchStudy(prepare = false, retry = false) {
      const res = await fetch(prepare ? "/api/coach/study" : `/api/coach/study?${source}`, {
        method: prepare ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        ...(prepare ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          session_id: sessionId, retry, ...(request.module_id ? { module_id: request.module_id } : {}),
        }) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "学习材料读取失败");
      return StudyViewSchema.parse(data);
    }
    async function poll() {
      try {
        setBusy(true);
        let data = await fetchStudy(first && Boolean(request.retry), Boolean(request.retry));
        first = false;
        if (["idle", "preparing"].includes(data.status) && Date.now() - lastPrepare > 20_000) {
          lastPrepare = Date.now();
          data = await fetchStudy(true);
        }
        if (controller.signal.aborted) return;
        setStudy(data);
        setError(null);
        if (["idle", "preparing"].includes(data.status)
          || ((!runId || data.coach_run?.id === runId) && ["running", "pending"].includes(data.coach_run?.status ?? ""))) {
          timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "学习服务暂不可用");
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, source, request, runId]);

  function reload(retry = false, id?: string) {
    setRequest((r) => ({ nonce: r.nonce + 1, retry, module_id: id }));
  }
  const targets = study?.targets ?? [];
  // 旧 m1/m2 链接只在当前真实会话的任务顺序内解析。
  const legacyIndex = moduleId?.match(/^m([1-9]\d*)$/);
  const active = targets.find((t) => t.module.id === moduleId)
    ?? (legacyIndex ? targets[Number(legacyIndex[1]) - 1] : undefined);
  const cards = targets.flatMap((t) => t.cards);
  const coachHref = `/interview/coach?${source}&version=${study?.version ?? ""}`;
  const focusHref = active ? `/setup?source=${encodeURIComponent(sessionId)}&focus=${encodeURIComponent(active.module.competency)}` : undefined;
  const differentRun = Boolean(runId && study && study.coach_run?.id !== runId);
  const run = differentRun ? null : study?.coach_run;

  return <div className="mt-6 space-y-10">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-accent-soft p-5">
      <div className="min-w-0"><h2 className="font-serif text-lg">根据这份面试报告继续学习</h2>
        <p className="mt-1 text-sm text-muted">{study?.role}{study?.company ? ` · ${study.company}` : ""}</p>
        <p className="mt-1 break-all text-xs text-muted">关联面试：{sessionId}</p></div>
      <Link href={`/report/${encodeURIComponent(sessionId)}`} className="text-sm text-accent underline">查看原报告</Link>
    </section>
    {error && <div role="alert" className="rounded-card border border-danger/30 p-5 text-sm text-danger">
      {error}。不会用示例替代真实材料。
      <Button variant="out" size="sm" onClick={() => reload()} className="ml-3" disabled={busy}>重新读取</Button>
    </div>}
    {!study && !error && <p role="status">正在读取学习目标…</p>}
    {study?.status === "failed" && <div role="alert" className="rounded-card border border-warn/30 p-5">
      <p>{study.error}</p><Button variant="out" className="mt-3" disabled={busy} onClick={() => reload(true)}>重试整理</Button>
    </div>}
    {study?.status === "preparing" && <p role="status" className="text-sm text-muted">正在整理学习材料，已就绪的任务可以先练习。</p>}
    {study?.status === "empty" && <p className="rounded-card border border-line p-6">本次未发现需要安排的成长目标。可以开始一场新的完整面试。</p>}
    {differentRun && <p id="coach-feedback" role="status">这次返回的练习已不是当前运行，未展示其他轮次的反馈。<Link href={`/prep?${source}#coach-feedback`} className="ml-2 text-accent underline">查看最新练习</Link></p>}
    {feedbackError && run?.status !== "ready" && <p role="alert">结束请求未确认送达，正在查询反馈；结果未保存前不会判定已掌握。</p>}
    {run && <section id="coach-feedback" className="scroll-mt-6 rounded-card border border-ok/25 bg-ok/5 p-5">
      <h2 className="font-serif text-xl">{runId ? "本次教练反馈" : "最近一轮教练反馈"}</h2>
      <p className="mt-2 text-sm text-muted">本轮包含全部 {targets.length} 个目标；非正式练习反馈，不改变原面试成绩。</p>
      {run.status === "pending" ? <p role="status">反馈整理中…</p>
        : run.status === "failed" ? <p role="alert">本次反馈未保存，不能用上次结果代替。<Button variant="out" size="sm" onClick={() => reload()}>重新查询反馈</Button></p>
        : run.status === "running" ? <p>本轮教练尚未结束。</p>
        : <ul className="mt-3 grid gap-3 sm:grid-cols-3">{targets.map((target) => {
          const feedback = run.feedback.find((f) => f.module_id === target.module.id);
          return <li key={target.module.id} className="min-w-0 rounded-card border border-line bg-paper p-4">
            <h3 className="font-medium">{target.module.competency}</h3>
            <p className="mt-2 text-sm text-muted">{feedback?.note || "本次尚未练习，不评价掌握程度。"}</p>
          </li>;
        })}</ul>}
    </section>}
    {targets.length > 0 && <>
      <section className="grid items-start gap-8 lg:grid-cols-[1.15fr_1fr]">
        <StudyPlan modules={targets.map((t) => t.module)} targets={targets} sessionId={sessionId}
          version={study!.version} busy={busy} onRetry={(id) => reload(true, id)} />
        <GroundedChat sessionId={sessionId} />
      </section>
      {moduleId && !active ? <p role="alert">这个学习目标已不属于当前材料版本。<Link href={`/prep?${source}`} className="text-accent underline">返回全部任务</Link></p>
        : <Flashcards key={`${sessionId}:${study!.version}`} mode="real" cards={cards}
          storageKey={`deepinterview:cards:${sessionId}:${study!.version}`}
          activeModule={active ? { title: active.module.title, competency: active.module.competency } : null}
          returnAllHref={`/prep?${source}#cards`} interviewHref={focusHref}
          coachHref={(active ? active.cards.length : cards.length) ? `${coachHref}${active ? `&module=${active.module.id}` : ""}` : undefined} />}
      <section className="rounded-card border border-ok/25 bg-ok/5 p-6">
        <h2 className="font-serif text-2xl">苏格拉底练习 · 全部成长目标</h2>
        <p className="my-3 text-sm leading-relaxed text-muted">无需逐项选择。教练会围绕本场报告的全部目标安排追问，你可以中途换项、深入或提前结束。未就绪的材料不会用无关问题替代。</p>
        {cards.length > 0 ? <Link href={coachHref} prefetch={false} className={buttonClasses()}>开始苏格拉底练习 →</Link>
          : <Button disabled>等待练习材料就绪</Button>}
      </section>
    </>}
  </div>;
}
