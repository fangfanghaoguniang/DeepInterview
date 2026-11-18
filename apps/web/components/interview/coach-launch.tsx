"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { CoachRunSchema, type StudyView } from "@deepinterview/shared";
import type { Persona } from "@/lib/personas";
import { CoachRoom } from "./coach-room";

const Reply = z.object({ run: CoachRunSchema, token: z.string(), url: z.string() });
export function CoachLaunch({ study, entryModule, persona }: {
  study: StudyView; entryModule: string | null; persona: Persona;
}) {
  const id = useRef<string | null>(null);
  const [data, setData] = useState<z.infer<typeof Reply> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    id.current ??= crypto.randomUUID();
    const controller = new AbortController();
    async function start() {
      try {
        const res = await fetch("/api/coach/run", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: study.session_id, version: study.version,
            entry_module: entryModule, run_id: id.current, action: "start" }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "教练练习启动失败");
        if (!controller.signal.aborted) setData(Reply.parse(json));
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "教练练习启动失败"); }
    }
    void start();
    return () => controller.abort();
  }, [study.session_id, study.version, entryModule]);
  if (!data) return <main className="mx-auto max-w-4xl px-6 py-12">
    <h1 className="font-serif text-3xl">苏格拉底练习 · 全部成长目标</h1>
    <p className="my-5" role={error ? "alert" : "status"}>{error ?? "正在连接教练，无需逐项选择…"}</p>
    <p className="mb-5 text-sm text-muted">本轮包含：{study.targets.map((t) => t.module.competency).join("、")}</p>
    <Link href={`/prep?session=${encodeURIComponent(study.session_id)}`} className="text-accent underline">返回当前面试的学习任务</Link>
  </main>;
  return <CoachRoom sessionId={study.session_id} persona={persona} token={data.token} url={data.url}
    run={data.run} targets={study.targets} />;
}
