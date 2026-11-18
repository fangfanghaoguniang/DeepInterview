"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileText, X } from "lucide-react";
import {
  LANGUAGES,
  type Language,
  type LanguageMode,
  type PrepSource,
} from "@deepinterview/shared";
import { startSession } from "@/app/setup/actions";
import { PERSONAS, DEFAULT_PERSONA_ID } from "@/lib/personas";
import { useMessages, useLocale } from "@/lib/i18n/client";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { DeviceCheck } from "@/components/setup/device-check";

// A small, friendly subset for the picker; full set still lives in LANGUAGES.
const LANGUAGE_LABELS: Partial<Record<Language, string>> = {
  en: "English",
  zh: "中文",
};
const OFFERED: Language[] = (
  ["zh", "en"] as Language[]
).filter((l) => (LANGUAGES as readonly string[]).includes(l));

type Step = { key: string; label: string };

// Friendly client-side minimums. The backend is the real guard — these just
// block obviously-empty / garbage-short submits with a helpful nudge.
const MIN_JD_CHARS = 40;
const MIN_CV_CHARS = 30;
// Max CV file size. Matches the /api/upload ceiling; also keeps the no-R2
// data-URL fallback (base64 is ~+33%) under the Next server-action body limit.
const MAX_CV_BYTES = 10 * 1024 * 1024;

// One-click sample inputs for fast testing / demos. Each is a matched CV + JD +
// company so the prep pipeline gets a coherent pair. Pure UX sugar — clicking a
// sample just fills the form fields; nothing is submitted.
//
// 上一版只有英文样本，中文用户点一下就会往表单里灌入大段英文，与界面叙事不符；
// 改为 locale-aware，中英各一套内容对齐的同岗位背景。
type Sample = {
  id: string;
  label: string;
  company: string;
  cv: string;
  jd: string;
};

const SAMPLES: Record<Locale, readonly Sample[]> = {
  en: [
    {
      id: "ai-pm",
      label: "AI Product Manager · Anthropic",
      company: "Anthropic",
      cv: "Maya Torres — Senior AI Product Manager. 6 years shipping LLM-powered products: led an enterprise copilot from 0 to 200k MAU; defined evaluation rubrics and red-team protocols with research; owned prompt/context strategy, model selection tradeoffs (cost / latency / quality), and cross-functional rollout with design, engineering and GTM. Skills: product strategy, prompt engineering, eval design, A/B testing, SQL, Figma, Jira, stakeholder management.",
      jd: "Senior AI Product Manager to own the roadmap for our assistant products. You will translate model capabilities into user value, define evaluation criteria with research, drive prompt and context design, and ship features end-to-end with engineering and design. Strong bias for action, deep familiarity with LLM behavior (grounding, refusal, latency/cost tradeoffs), and excellent written communication required.",
    },
    {
      id: "frontend",
      label: "Frontend Engineer · Vercel",
      company: "Vercel",
      cv: "Sam Chen — Senior Frontend Engineer. 6 years shipping performant React/Next.js apps. Built a design system used across 30+ surfaces; improved LCP 35% with streaming SSR and image optimization. Skills: TypeScript, React, Next.js, Tailwind, accessibility, Core Web Vitals.",
      jd: "Senior Frontend Engineer to build fast, delightful web experiences with Next.js and React. Own component architecture, Core Web Vitals, accessibility, and design-system work. Deep TypeScript and modern rendering (SSR/streaming) experience expected.",
    },
    {
      id: "ai-eng",
      label: "AI Engineer · LangChain",
      company: "LangChain",
      cv: "Ethan Park — Senior AI Engineer. 5 years building LLM-powered agents and RAG systems: shipped a multi-tool research agent handling 100k+ queries/day; owned prompt/context engineering, function-calling schemas, vector retrieval (pgvector + hybrid rerank), eval harnesses (LLM-as-judge + human review), and cost/latency tuning. Skills: Python, TypeScript, LangGraph, OpenAI/Anthropic APIs, RAG, tool use, structured output, observability (LangSmith, W&B).",
      jd: "Senior AI Engineer to build agentic products end-to-end. You will design prompt and context strategies, wire tool/function calling across services, ship RAG pipelines with retrieval quality you can measure, and own eval, observability, and cost/latency budgets. Strong Python, fluency with modern LLM APIs (OpenAI, Anthropic, open-weight), and hands-on experience with agent frameworks (LangGraph, LlamaIndex, or your own) required.",
    },
  ],
  zh: [
    {
      id: "ai-pm",
      label: "AI 产品经理 · Anthropic",
      company: "Anthropic",
      cv: "林悦 — 高级 AI 产品经理。6 年 LLM 产品经验：主导企业级 Copilot 从 0 到 20 万 MAU 上线；与研究团队共同制定评估基准与红队协议；负责 Prompt、上下文策略与模型选型（成本/延迟/质量三角权衡），与设计、工程、GTM 跨职能推进落地。技能：产品策略、Prompt 工程、评估体系设计、A/B 实验、SQL、Figma、Jira、跨部门协作。",
      jd: "招聘高级 AI 产品经理，负责助手类产品路线图。你需要把模型能力翻译成用户价值，与研究团队共同定义评估标准，主导 Prompt 与上下文设计，并和工程、设计端到端交付功能。要求强行动力、对 LLM 行为（接地、拒答、延迟与成本权衡）有深入理解、优秀的书面表达。",
    },
    {
      id: "frontend",
      label: "前端工程师 · Vercel",
      company: "Vercel",
      cv: "陈曦 — 高级前端工程师。6 年高性能 React/Next.js 应用交付经验。搭建被 30+ 业务界面复用的设计系统；通过流式 SSR 与图片优化将 LCP 提升 35%。技能：TypeScript、React、Next.js、Tailwind、可访问性、Core Web Vitals。",
      jd: "招聘高级前端工程师，用 Next.js 与 React 打造快速、愉悦的 Web 体验。负责组件架构、Core Web Vitals、可访问性与设计系统建设。要求精通 TypeScript 与现代渲染范式（SSR/流式渲染）。",
    },
    {
      id: "ai-eng",
      label: "AI 应用工程师 · LangChain",
      company: "LangChain",
      cv: "周涛 — 高级 AI 应用工程师。5 年 LLM Agent 与 RAG 系统落地经验：主导多工具研究助手上线，日均处理 10 万+ 查询；负责 Prompt/上下文工程、函数调用 schema 设计、向量检索（pgvector + 混合 rerank）、评估体系（LLM-as-judge + 人工复核）与成本/延迟调优。技能：Python、TypeScript、LangGraph、OpenAI/Anthropic API、RAG、工具调用、结构化输出、可观测性（LangSmith、W&B）。",
      jd: "招聘高级 AI 应用工程师，端到端构建 Agent 产品。你需要设计 Prompt 与上下文策略、跨服务串联工具/函数调用、交付可度量检索质量的 RAG 管道，并负责评估、可观测性与成本/延迟预算。要求扎实的 Python，熟悉现代 LLM API（OpenAI、Anthropic、开源权重），并有 Agent 框架（LangGraph、LlamaIndex 或自研）实战经验。",
    },
  ],
};

export function SetupForm({ r2Configured, source = null, sourceError = null }: {
  r2Configured: boolean;
  source?: PrepSource | null;
  sourceError?: string | null;
}) {
  const router = useRouter();
  const messages = useMessages();
  const locale = useLocale();
  const samples = SAMPLES[locale] ?? SAMPLES.zh;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const originalCv = source?.input.cv_url ?? "";
  const cvIsReference = /^(https?:|data:)/i.test(originalCv);
  const [reuseCv, setReuseCv] = useState(cvIsReference && Boolean(originalCv));
  const [focusEnabled, setFocusEnabled] = useState(Boolean(source));
  const [sourceDismissed, setSourceDismissed] = useState(false);
  const [cvText, setCvText] = useState(cvIsReference ? "" : originalCv);
  const [jdText, setJdText] = useState(source?.input.jd_text ?? "");
  const [company, setCompany] = useState(source?.input.company ?? "");
  // 换肤定稿（2026-11 拍板）：面试语言默认中文；用户仍可手动切 English。
  const [primary, setPrimary] = useState<Language>(source?.input.language_mode.primary ?? "zh");
  const [mixed, setMixed] = useState(source?.input.language_mode.mixed ?? false);
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);

  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Surface inline field errors once the user has interacted with a field (or
  // attempted submit) — not on first load. Decoupled from submit because the
  // submit button is disabled while invalid, so it never fires onSubmit.
  const [cvTouched, setCvTouched] = useState(false);
  const [jdTouched, setJdTouched] = useState(false);

  // --- Client-side input validation (friendly; backend is the real guard) ---
  // CV is satisfied by a chosen file (length unknown synchronously) OR pasted
  // text of at least MIN_CV_CHARS. JD must be present + reasonably long.
  // Company is optional.
  const cvLen = cvText.trim().length;
  const jdLen = jdText.trim().length;
  const cvError = reuseCv && !file && !cvText.trim() ? null : !file
    ? cvLen === 0
      ? t(messages, "setup.needCv")
      : cvLen < MIN_CV_CHARS
        ? t(messages, "setup.cvTooShort").replace(
            "{min}",
            String(MIN_CV_CHARS),
          )
        : null
    : file.size > MAX_CV_BYTES
      ? t(messages, "setup.fileTooLarge").replace(
          "{max}",
          String(Math.floor(MAX_CV_BYTES / (1024 * 1024))),
        )
      : null;
  const jdError =
    jdLen === 0
      ? t(messages, "setup.needJd")
      : jdLen < MIN_JD_CHARS
        ? t(messages, "setup.jdTooShort").replace(
            "{min}",
            String(MIN_JD_CHARS),
          )
        : null;
  const blockedSource = Boolean(sourceError) && !sourceDismissed;
  const canSubmit = !cvError && !jdError && !submitting && !blockedSource;

  // Fill the form with a matched sample (testing / demo). Clears any chosen file
  // so the pasted sample CV text is what gets submitted.
  function loadSample(s: Sample) {
    setReuseCv(false);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setCvText(s.cv);
    setJdText(s.jd);
    setCompany(s.company);
    setCvTouched(false);
    setJdTouched(false);
    setError(null);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  /**
   * Read a file as a base64 `data:` URL of its RAW bytes (no R2 configured).
   * The agent base64-decodes this and parses the real document (PDF/DOCX) —
   * unlike `file.text()`, which mangles binary formats into garbage.
   */
  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(
          new Error(
            "setup.readFailed", // dict key; resolved in onSubmit's catch
          ),
        );
      reader.readAsDataURL(f);
    });
  }

  /** Upload the chosen file to R2 (presign → PUT) and return its public URL. */
  async function uploadToR2(f: File): Promise<string> {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: f.name,
        content_type: f.type || "application/octet-stream",
        size: f.size,
      }),
    });
    if (!res.ok) throw new Error("setup.uploadPrepareFailed");
    const { uploadUrl, publicUrl } = (await res.json()) as {
      uploadUrl: string;
      publicUrl: string;
    };
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": f.type || "application/octet-stream" },
      body: f,
    });
    if (!put.ok) throw new Error("setup.uploadFailed");
    return publicUrl;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation. CV can be a file OR pasted text; JD required +
    // min length; company is optional. Surface inline field errors and bail.
    if (cvError || jdError || blockedSource) {
      setCvTouched(true);
      setJdTouched(true);
      return;
    }

    setSubmitting(true);
    setActiveStep(0);

    try {
      // CV resolution: upload only when a file is chosen AND R2 is configured.
      // Otherwise pass the pasted text directly as cv_url — the prep pipeline
      // treats a non-URL cv_url as the document itself (offline-friendly).
      let cv_url: string;
      if (file && r2Configured) {
        cv_url = await uploadToR2(file);
      } else if (file) {
        // File chosen but no storage — send the RAW bytes as a base64 data URL
        // so the agent can parse the real document (NOT file.text(), which
        // turns a PDF/DOCX into binary garbage).
        cv_url = await fileToDataUrl(file);
      } else if (cvText.trim()) {
        cv_url = cvText.trim();
      } else {
        cv_url = reuseCv ? originalCv : "";
      }

      setActiveStep(1);
      const language_mode: LanguageMode = { primary, mixed };
      const result = await startSession({
        cv_url,
        jd_text: jdText.trim(),
        company: company.trim(),
        language_mode,
        ...(focusEnabled && source ? {
          source_session_id: source.focus.session_id,
          focus_competency: source.focus.competency,
        } : {}),
      });

      if (!result.ok) {
        // Required-auth distribution and the session expired mid-form →
        // sign back in, then return to setup.
        if (result.reason === "auth_required") {
          router.push("/login?next=/setup");
          return;
        }
        setError(result.error);
        setSubmitting(false);
        return;
      }

      setActiveStep(2);
      // Carry the chosen persona forward (PrepRequest has no persona field yet;
      // WP-2 will persist it server-side). Query param keeps P1 stateless.
      // Route to the prep screen — it polls the agent, shows the agents
      // working, then the "what we found" bento, then hands off to /interview.
      router.push(
        `/session/${result.session_id}${
          personaId ? `?persona=${encodeURIComponent(personaId)}` : ""
        }`,
      );
    } catch (err) {
      // Our own upload/read failures carry a dictionary key as their message;
      // anything else (network, server) falls through to the generic error.
      const raw = err instanceof Error ? err.message : "";
      const translated = raw.startsWith("setup.") ? t(messages, raw) : "";
      setError(
        translated ||
          (raw && !raw.startsWith("setup.")
            ? raw
            : t(messages, "common.error")),
      );
      setSubmitting(false);
    }
  }

  const steps: Step[] = [
    { key: "cv", label: t(messages, "setup.stepCv") },
    { key: "company", label: t(messages, "setup.stepCompany") },
    { key: "plan", label: t(messages, "setup.stepPlan") },
  ];

  if (submitting) {
    const researching = t(messages, "setup.researching").replace(
      "{company}",
      company.trim() || t(messages, "setup.companyLabel"),
    );
    return (
      <Card className="mt-8">
        <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
          <Spinner className="h-6 w-6" />
          <p className="serif text-xl text-ink">{researching}</p>
          <ol className="flex flex-col gap-2 text-left">
            {steps.map((s, i) => (
              <li
                key={s.key}
                className={cn(
                  "flex items-center gap-2 text-[13px]",
                  i < activeStep
                    ? "text-ok"
                    : i === activeStep
                      ? "text-ink"
                      : "text-faint",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    i < activeStep
                      ? "bg-ok"
                      : i === activeStep
                        ? "bg-accent"
                        : "bg-line",
                  )}
                />
                {s.label}
              </li>
            ))}
          </ol>
          {error && (
            <p className="text-[13px] text-ink-soft" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-6">
      <div>
        <h1 className="serif text-3xl text-ink">
          {t(messages, "setup.title")}
        </h1>
        <p className="mt-2 text-ink-soft">{t(messages, "setup.subtitle")}</p>
      </div>

      {sourceError && !sourceDismissed && (
        <section className="rounded-xl border border-line bg-paper p-5" role="alert">
          <p>无法沿用原面试：{sourceError}。未填入示例资料。</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" variant="out" onClick={() => router.refresh()}>重新读取</Button>
            <Button type="button" variant="ghost" onClick={() => setSourceDismissed(true)}>
              改为普通面试，手动填写
            </Button>
          </div>
        </section>
      )}
      {source && (
        <section className="rounded-xl border border-line bg-accent-soft p-5">
          <h2 className="font-serif text-xl">{focusEnabled ? `本次面试重点：${source.focus.competency}` : "已取消重点，改为普通面试"}</h2>
          <p className="mt-2 text-sm text-muted">{focusEnabled ? "仍是一场完整面试，提高此项考查比例，同时考查其他岗位能力。" : "已填写的简历、岗位和语言设置保持不变。"}</p>
          {focusEnabled && <ul className="mt-2 space-y-1 text-sm">{source.focus.growth.map((text, i) => <li key={i}>{text}</li>)}</ul>}
          <p className="mt-2 text-sm">来源：上一场面试的成长建议。请检查沿用资料，失效的简历链接需重新上传。</p>
          {(!originalCv || !source.input.jd_text) && <p className="mt-2 text-sm" role="alert">部分原资料缺失，请补充简历或岗位要求后开始。</p>}
          <button type="button" className="mt-3 text-sm text-accent underline" onClick={() => setFocusEnabled(!focusEnabled)}>
            {focusEnabled ? "取消重点，改为普通面试" : "恢复本次重点"}
          </button>
        </section>
      )}

      {/* Quick demo: one-click sample CV + JD + company for fast testing */}
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-medium text-ink">
              {t(messages, "setup.quickDemoTitle")}
            </p>
            <p className="text-[12px] text-muted">
              {t(messages, "setup.quickDemoHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => loadSample(s)}
                className="rounded-[10px] border border-line px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-ink"
              >
                {s.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* CV */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.cvLabel")}</CardTitle>
          <CardDescription>{t(messages, "setup.cvHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-6">
          {reuseCv && !file && !cvText.trim() && <div className="rounded-lg bg-paper p-3 text-sm">
            已沿用上次上传的简历；上传新文件或粘贴文字可替换。
            <button type="button" className="ml-2 text-accent underline" onClick={() => setReuseCv(false)}>不再沿用</button>
          </div>}
          <div
            role="button"
            tabIndex={0}
            aria-label={t(messages, "setup.cvDrop")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-dashed px-4 py-8 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
              dragging
                ? "border-accent bg-accent-soft"
                : "border-line hover:border-ink",
            )}
          >
            {file ? (
              <span className="flex min-w-0 max-w-full items-center gap-2 text-[14px] text-ink">
                <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                {/* 移动端长文件名截断，不允许撑破卡片 */}
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={t(messages, "setup.removeFileAria")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-muted hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            ) : (
              <>
                <UploadCloud className="h-5 w-5 text-muted" aria-hidden />
                <span className="text-[13px] text-muted">
                  {t(messages, "setup.cvDrop")}
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div>
            <Label htmlFor="cvText">{t(messages, "setup.cvPasteLabel")}</Label>
            <Textarea
              id="cvText"
              rows={5}
              placeholder={t(messages, "setup.cvPasteHint")}
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              onBlur={() => setCvTouched(true)}
              aria-invalid={cvTouched && Boolean(cvError)}
            />
          </div>
          {cvTouched && cvError && (
            <p className="text-[13px] text-accent" role="alert">
              {cvError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* JD */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.jdLabel")}</CardTitle>
          <CardDescription>{t(messages, "setup.jdHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pb-6">
          <Textarea
            rows={6}
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            onBlur={() => setJdTouched(true)}
            aria-label={t(messages, "setup.jdLabel")}
            aria-invalid={jdTouched && Boolean(jdError)}
          />
          {jdTouched && jdError && (
            <p className="text-[13px] text-accent" role="alert">
              {jdError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Company */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.companyLabel")}</CardTitle>
          <CardDescription>{t(messages, "setup.companyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder={t(messages, "setup.companyPlaceholder")}
            aria-label={t(messages, "setup.companyLabel")}
          />
        </CardContent>
      </Card>

      {/* Language mode */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.languageLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-6">
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set([...OFFERED, primary])).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setPrimary(lang)}
                aria-pressed={primary === lang}
                className={cn(
                  "rounded-[10px] border px-3.5 py-2 text-[13px] transition-colors",
                  primary === lang
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-ink-soft hover:border-ink",
                )}
              >
                {LANGUAGE_LABELS[lang] ?? lang}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              checked={mixed}
              onChange={(e) => setMixed(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {t(messages, "setup.languageMixed")}
          </label>
        </CardContent>
      </Card>

      {/* Persona */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.personaLabel")}</CardTitle>
          <CardDescription>{t(messages, "setup.personaHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 pb-6 sm:grid-cols-3">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersonaId(p.id)}
              aria-pressed={personaId === p.id}
              className={cn(
                "flex flex-col gap-2 rounded-[10px] border p-3 text-left transition-colors",
                personaId === p.id
                  ? "border-accent bg-accent-soft"
                  : "border-line hover:border-ink",
              )}
            >
              <div
                className="aspect-[4/3] w-full rounded-md border border-line bg-paper bg-cover bg-center"
                style={{ backgroundImage: `url(${p.poster_url})` }}
                aria-hidden
              />
              <div>
                <p className="text-[14px] font-medium text-ink">{p.name}</p>
                <p className="text-[12px] leading-snug text-muted">{p.style}</p>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Device check */}
      <Card>
        <CardHeader>
          <CardTitle>{t(messages, "setup.deviceLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          <DeviceCheck />
        </CardContent>
      </Card>

      {error && (
        <p className="text-[13px] text-ink-soft" role="alert">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="self-start"
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
      >
        {focusEnabled ? "开始完整面试" : t(messages, "setup.start")}
      </Button>
    </form>
  );
}
