"use client";

/**
 * <CoachRoom> — the spoken Socratic study-coach screen.
 *
 * A deliberate simplification of <LiveRoom> (the interview screen), sharing
 * its machinery rather than duplicating it: the same push-to-talk recording
 * coordinator, the same purely-manual turn commit signal, the same half-duplex
 * mic gating, the same failure chrome. What differs is the framing: there is
 * no question panel and no report — the coach asks ONE thread at a time and
 * leaving routes back to /prep, where the study plan lives.
 *
 * CONTRACT: the finish signal topic must match worker_coach.py FINISH_TURN_TOPIC
 * (inherited from worker.py) — it is the ONLY thing that ends a learner's turn
 * (purely manual turn-taking, same as the interview).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import {
  ConnectionState,
  DisconnectReason,
  MediaDeviceFailure,
  Track,
} from "livekit-client";
import "@livekit/components-styles";

import type { Persona } from "@/lib/personas";
import { StudyViewSchema, type CoachRun, type StudyTarget } from "@deepinterview/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useMessages } from "@/lib/i18n/client";
import { t } from "@/lib/i18n";
import { describeMicFailure } from "@/lib/mic-failure";
import {
  ErrorNotice,
  useAgentNeverJoined,
} from "@/components/interview/room-primitives";
import { VoiceStage, StagePreview } from "@/components/interview/voice-stage";
import {
  TranscriptPanel,
  type Turn,
} from "@/components/interview/transcript-panel";
import { ControlBar } from "@/components/interview/control-bar";
import { SessionTimer } from "@/components/interview/session-timer";
import { TextFallback } from "@/components/interview/text-fallback";

// The text-stream topic livekit-agents' RoomIO registers its chat handler on.
const AGENT_CHAT_TOPIC = "lk.chat";

export interface CoachRoomProps {
  /** The INTERVIEW session the coach briefed itself from (trace/debug hook). */
  sessionId: string;
  persona: Persona;
  /** Null when LiveKit is unconfigured → preview (not-connected) mode. */
  token: string | null;
  url: string | null;
  run?: CoachRun;
  targets?: StudyTarget[];
}

/* ------------------------------------------------------------------ */
/* Frame — the same calm two-column layout as the interview room.      */
/* ------------------------------------------------------------------ */

function CoachFrame({
  persona,
  stage,
  transcript,
  timer,
  controls,
  textFallback,
  notice, goals,
}: {
  persona: Persona;
  stage: React.ReactNode;
  transcript: React.ReactNode;
  timer: React.ReactNode;
  controls: React.ReactNode;
  textFallback: React.ReactNode;
  notice?: React.ReactNode;
  goals?: React.ReactNode;
}) {
  return (
    // .coach-tone：教练间整棵子树的 accent 换绿（见 globals.css），与面试间
    // 的靛蓝强调形成语义区分——教练是培养，不是考核。
    <main className="coach-tone relative min-h-screen overflow-hidden bg-paper">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 50% -10%, rgba(31,122,92,0.07), transparent 60%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] tracking-[0.16em] text-faint">
              DEEPINTERVIEW · COACH
            </span>
            <h1 className="font-serif text-[17px] font-normal text-ink">
              {persona.name}
            </h1>
          </div>
          {timer}
        </div>

        {goals}
        <div className="mt-6 grid flex-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="mx-auto w-full max-w-sm lg:max-w-md">{stage}</div>
          <div className="flex h-full max-h-[60vh] min-h-[280px] flex-col lg:max-h-[68vh]">
            {transcript}
          </div>
        </div>

        {notice}

        <div className="mt-6 flex flex-col items-center gap-4">
          {controls}
          <div className="w-full max-w-xl">{textFallback}</div>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* LIVE session — descendant of <LiveKitRoom>; owns all LiveKit hooks. */
/* ------------------------------------------------------------------ */

function CoachSession({
  persona, sessionId, run, targets, returnHref,
  micError,
  onMicError,
}: {
  persona: Persona;
  sessionId: string;
  run?: CoachRun;
  targets: StudyTarget[];
  returnHref: string;
  micError: string | null;
  onMicError: (message: string | null) => void;
}) {
  const router = useRouter();
  const messages = useMessages();
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const reconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  const { localParticipant, microphoneTrack } = useLocalParticipant();
  // Whether the mic device is published at all — independent of mute (see the
  // isMicrophoneEnabled trap noted in live-room.tsx).
  const micAvailable = !!microphoneTrack;
  const transcriptions = useTranscriptions();
  const { state: agentState, agent } = useVoiceAssistant();
  const activeGoal = agent?.attributes["coach.active"];
  let answered: Record<string, number> = {};
  try { answered = JSON.parse(agent?.attributes["coach.answered"] || "{}"); } catch { /* 等待有效的服务端状态 */ }
  const agentNeverJoined = useAgentNeverJoined(
    connected,
    agentState !== "disconnected",
  );

  const [ending, setEnding] = React.useState(false);

  // Push-to-talk + half-duplex: mic live only while recording; the converge
  // effect below is the single place track mute state is written.
  const [recording, setRecording] = React.useState(false);
  const [recordSeconds, setRecordSeconds] = React.useState(0);
  const [answerPending, setAnswerPending] = React.useState(false);
  const [controlNotice, setControlNotice] = React.useState<string | null>(null);
  const pendingAnswer = React.useRef<number | null>(null);
  const answeredCount = Object.values(answered).reduce((sum, count) => sum + count, 0);
  const room = useRoomContext();

  React.useEffect(() => {
    if (pendingAnswer.current !== null && answeredCount > pendingAnswer.current) {
      pendingAnswer.current = null;
      setAnswerPending(false);
      setControlNotice(null);
    }
  }, [answeredCount]);

  React.useEffect(() => {
    if (!answerPending) return;
    const timer = setTimeout(() => {
      pendingAnswer.current = null;
      setAnswerPending(false);
      setControlNotice("尚未确认这次回答已被记录，请检查转写后重试；也可以结束练习，未确认的回答不会作为已掌握依据。");
    }, 45_000);
    return () => clearTimeout(timer);
  }, [answerPending]);

  React.useEffect(() => {
    if (!run || !connected || ending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function checkFeedback() {
      try {
        const response = await fetch(`/api/coach/study?session=${encodeURIComponent(sessionId)}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (response.ok) {
          const result = StudyViewSchema.safeParse(await response.json());
          const saved = result.success ? result.data.coach_run : null;
          if (!controller.signal.aborted && saved?.id === run!.id && saved.status === "ready") {
            setEnding(true);
            await room.disconnect();
            router.push(returnHref);
            return;
          }
        }
      } catch { /* 暂时查询失败不结束仍在进行的对话。 */ }
      if (!controller.signal.aborted) timer = setTimeout(checkFeedback, 3000);
    }
    timer = setTimeout(checkFeedback, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connected, ending, run?.id, sessionId, room, router, returnHref]);

  React.useEffect(() => {
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    if (recording) {
      if (pub.isMuted) void pub.unmute();
    } else if (!pub.isMuted) {
      void pub.mute();
    }
  }, [recording, microphoneTrack, localParticipant]);

  // Purely manual turn-taking: fires on the recording true->false edge so the
  // button tap, the 90s auto-stop and the device-mute path all route through
  // it uniformly. CONTRACT: topic must match the worker's FINISH_TURN_TOPIC.
  const prevRecording = React.useRef(false);
  React.useEffect(() => {
    if (prevRecording.current && !recording) {
      pendingAnswer.current = answeredCount;
      setAnswerPending(true);
      void room.localParticipant.publishData(
        new TextEncoder().encode("finish"),
        { topic: "finish_answer", reliable: true },
      ).catch(() => {
        pendingAnswer.current = null;
        setAnswerPending(false);
        setControlNotice("回答提交信号未送达，请检查连接后重试；尚未将这次录音计为已回答。");
      });
    }
    prevRecording.current = recording;
  }, [recording, room, answeredCount]);

  // Auto-stop safeguard: a missed "I'm done" tap can't wedge the turn open.
  // Longer ceiling than the interview's 90s — thinking out loud under Socratic
  // questioning takes more room than answering a fixed question.
  React.useEffect(() => {
    if (!recording) {
      setRecordSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setRecordSeconds(s);
      if (s >= 120) setRecording(false);
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const focusedOnConnect = React.useRef(false);
  React.useEffect(() => {
    if (!connected || focusedOnConnect.current) return;
    focusedOnConnect.current = true;
    const el = transcriptRef.current;
    const active =
      typeof document === "undefined" ? null : document.activeElement;
    if (el && (active === null || active === document.body)) {
      el.focus({ preventScroll: true });
    }
  }, [connected]);

  React.useEffect(() => {
    if (micAvailable) onMicError(null);
  }, [micAvailable, onMicError]);

  const [typedTurns, setTypedTurns] = React.useState<
    { id: string; text: string; at: number }[]
  >([]);

  // Streaming transcriptions + typed answers → turns, same merge logic as the
  // interview room. The coach speaks through the "interviewer" role; the panel
  // label is overridden to "Coach" below.
  const turns: Turn[] = React.useMemo(() => {
    const localIdentity = localParticipant.identity;
    const entries: (Turn & { at: number })[] = [];
    for (const tr of transcriptions) {
      const text = tr.text.trim();
      if (!text) continue;
      entries.push({
        at: tr.streamInfo.timestamp ?? 0,
        id: tr.streamInfo.id,
        role:
          tr.participantInfo.identity === localIdentity
            ? ("candidate" as const)
            : ("interviewer" as const),
        text,
      });
    }
    for (const tt of typedTurns) {
      entries.push({ at: tt.at, id: tt.id, role: "candidate", text: tt.text });
    }
    entries.sort((a, b) => a.at - b.at);
    const merged: Turn[] = [];
    for (const entry of entries) {
      const last = merged[merged.length - 1];
      if (last?.role === entry.role) {
        last.text = `${last.text} ${entry.text}`;
      } else {
        merged.push({ id: entry.id, role: entry.role, text: entry.text });
      }
    }
    return merged;
  }, [transcriptions, typedTurns, localParticipant.identity]);

  function toggleRecording() {
    if (recording) {
      setRecording(false);
      return;
    }
    if (!connected || !micAvailable || ending || pendingAnswer.current !== null) return;
    setControlNotice(null);
    setRecording(true);
  }

  async function toggleMute() {
    try {
      if (micAvailable) setRecording(false);
      await localParticipant.setMicrophoneEnabled(!micAvailable);
      onMicError(null);
    } catch (error) {
      onMicError(
        describeMicFailure(messages, MediaDeviceFailure.getFailure(error)),
      );
    }
  }

  async function endSession() {
    if (recording) {
      setRecording(false);
      setControlNotice("已停止录音并提交回答。请等待识别完成后，再次结束练习。");
      return;
    }
    if (pendingAnswer.current !== null) {
      setControlNotice("正在等待这次回答被记录，请稍后再结束练习，以免丢失最后一句。");
      return;
    }
    setEnding(true);
    try {
      await localParticipant.setMicrophoneEnabled(false);
    } catch {
      // best-effort; proceed to leave regardless
    }
    // The coach's home is the prep page — that's where the study plan and the
    // cards it just talked about live. No report to route to.
    let failed = false;
    if (run) {
      try {
        const response = await fetch("/api/coach/run", { method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", session_id: sessionId, version: run.version, run_id: run.id }),
        });
        failed = !response.ok;
      } catch { failed = true; }
    }
    await room.disconnect();
    router.push(failed ? returnHref.replace("#", "&feedback_error=1#") : returnHref);
  }

  async function controlGoal(action: string, module_id?: string) {
    if (recording || pendingAnswer.current !== null || ending) return;
    try {
      await localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ action, module_id })),
        { topic: "coach_control", reliable: true });
    } catch { onMicError("目标切换未送达，请等待连接恢复后重试。"); }
  }

  function sendText(text: string) {
    if (!connected || ending || recording || pendingAnswer.current !== null) return;
    pendingAnswer.current = answeredCount;
    setAnswerPending(true);
    setControlNotice(null);
    setTypedTurns((prev) => [
      ...prev,
      { id: `typed-${Date.now()}-${prev.length}`, text, at: Date.now() },
    ]);
    void localParticipant
      .sendText(text, { topic: AGENT_CHAT_TOPIC })
      .catch(() => {
        pendingAnswer.current = null;
        setAnswerPending(false);
        setControlNotice("文字回答未送达，请检查连接后重试；未计入本轮练习。");
      });
  }

  return (
    <CoachFrame
      persona={persona}
      goals={<section className="mt-5 rounded-card border border-ok/25 bg-ok/5 p-4">
        <h2 className="font-serif text-xl">苏格拉底练习 · 全部成长目标</h2>
        <p className="mt-2 text-sm text-muted">无需逐项选择。当前聚焦一项，整场包含全部目标；你可以换项、深入或提前结束。本轮不是正式面试评分。</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">{targets.map((target) => <li key={target.module.id} className="min-w-0 rounded-card border border-line bg-paper p-3">
          <h3 className="font-medium">{target.module.competency}</h3>
          <p className="my-2 text-xs text-muted">{target.module.id === activeGoal ? "正在练习" : answered[target.module.id] ? "已回答 · 可继续深入" : target.cards.length ? "尚未练习" : "材料未就绪"}</p>
          <Button variant="out" size="sm" disabled={!connected || !activeGoal || recording || answerPending || ending || agentState === "thinking" || agentState === "speaking" || !target.cards.length || target.module.id === activeGoal}
            onClick={() => void controlGoal("switch", target.module.id)}>切到此项</Button>
        </li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="out" size="sm" disabled={!connected || !activeGoal || recording || answerPending || ending || agentState === "thinking" || agentState === "speaking"} onClick={() => void controlGoal("next")}>换下一个目标</Button>
          <Button variant="out" size="sm" disabled={!connected || !activeGoal || recording || answerPending || ending || agentState === "thinking" || agentState === "speaking"} onClick={() => void controlGoal("deepen")}>这一项再深入一点</Button>
        </div>
      </section>}
      stage={<VoiceStage persona={persona} />}
      transcript={
        <TranscriptPanel
          turns={turns}
          live
          className="h-full"
          scrollRegionRef={transcriptRef}
          otherLabel={t(messages, "coach.speakerCoach")}
        />
      }
      timer={<SessionTimer running={connected} />}
      controls={
        <div className="flex flex-col items-center gap-3">
          {(controlNotice || answerPending) && <p role="status" className="max-w-xl text-center text-sm text-muted">
            {controlNotice || "正在确认本次回答，请稍候；确认前暂不切换目标。"}
          </p>}
          <StartAudio
            label={t(messages, "interview.enableAudio")}
            className="rounded-full border border-accent bg-accent-soft px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          />
          <ControlBar
            micEnabled={micAvailable}
            onToggleMute={() => void toggleMute()}
            onEnd={() => void endSession()}
            ending={ending}
            endLabel={t(messages, "coach.endSession")}
            recording={recording}
            recordDisabled={!connected || !micAvailable || ending || answerPending}
            recordSeconds={recordSeconds}
            onToggleRecord={toggleRecording}
          />
        </div>
      }
      textFallback={<TextFallback onSend={sendText} disabled={!connected || ending || recording || answerPending} />}
      notice={
        micError ? (
          <ErrorNotice
            title={t(messages, "interview.micUnavailable")}
            message={`${micError} ${t(messages, "interview.micTypeFallback")}`}
          />
        ) : agentNeverJoined ? (
          <ErrorNotice
            title={t(messages, "coach.agentMissing")}
            message={t(messages, "coach.agentMissingBody")}
          />
        ) : reconnecting ? (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto mt-6 max-w-xl rounded-card border border-line bg-paper/70 px-4 py-3 text-center text-[13px] text-muted backdrop-blur-sm"
          >
            {t(messages, "interview.reconnecting")}
          </div>
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Shells — preview (offline), connecting (pre-mount), connection lost. */
/* ------------------------------------------------------------------ */

function PreviewCoach({ persona }: { persona: Persona }) {
  const messages = useMessages();
  return (
    <CoachFrame
      persona={persona}
      stage={<StagePreview persona={persona} />}
      transcript={<TranscriptPanel turns={[]} className="h-full" />}
      timer={<SessionTimer running={false} />}
      controls={
        <ControlBar
          micEnabled
          onToggleMute={() => {}}
          onEnd={() => {}}
          disabled
        />
      }
      textFallback={<TextFallback onSend={() => {}} disabled />}
      notice={
        <div
          className={cn(
            "mx-auto mt-6 max-w-xl rounded-card border border-line",
            "bg-paper/70 px-4 py-3 text-center text-[13px] text-muted backdrop-blur-sm",
          )}
          role="status"
        >
          {t(messages, "coach.previewBody")}
        </div>
      }
    />
  );
}

function ConnectingCoach({ persona }: { persona: Persona }) {
  const messages = useMessages();
  return (
    <CoachFrame
      persona={persona}
      stage={<StagePreview persona={persona} />}
      transcript={<TranscriptPanel turns={[]} className="h-full" />}
      timer={<SessionTimer running={false} />}
      controls={
        <ControlBar
          micEnabled
          onToggleMute={() => {}}
          onEnd={() => {}}
          disabled
        />
      }
      textFallback={<TextFallback onSend={() => {}} disabled />}
      notice={
        <div
          className="mx-auto mt-6 max-w-xl rounded-card border border-line bg-paper/70 px-4 py-3 text-center text-[13px] text-muted backdrop-blur-sm"
          role="status"
        >
          {t(messages, "coach.connecting")}
        </div>
      }
    />
  );
}

function LostCoach({
  persona,
  message,
  onRejoin, returnHref,
}: {
  persona: Persona;
  message: string;
  returnHref: string;
  onRejoin: () => void;
}) {
  const messages = useMessages();
  return (
    <CoachFrame
      persona={persona}
      stage={<StagePreview persona={persona} />}
      transcript={<TranscriptPanel turns={[]} className="h-full" />}
      timer={<SessionTimer running={false} />}
      controls={
        <div className="flex flex-col items-center gap-3">
          <ControlBar
            micEnabled
            onToggleMute={() => {}}
            onEnd={() => {}}
            disabled
          />
          <Link
            href={returnHref}
            className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            {t(messages, "coach.backToPrep")}
          </Link>
        </div>
      }
      textFallback={<TextFallback onSend={() => {}} disabled />}
      notice={
        <ErrorNotice
          title={t(messages, "interview.connLost")}
          message={message}
          action={
            <button
              type="button"
              onClick={onRejoin}
              className="rounded-full border border-accent bg-accent-soft px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              {t(messages, "interview.rejoin")}
            </button>
          }
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Orchestrator.                                                        */
/* ------------------------------------------------------------------ */

export function CoachRoom({ sessionId, persona, token, url, run, targets = [] }: CoachRoomProps) {
  const returnHref = `/prep?session=${encodeURIComponent(sessionId)}${run?.entry_module ? `&module=${run.entry_module}` : ""}${run ? `&run=${run.id}` : ""}#coach-feedback`;
  const router = useRouter();
  const messages = useMessages();

  // Guard the browser-only LiveKit client from SSR / first hydration.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [micError, setMicError] = React.useState<string | null>(null);
  const [connectionLost, setConnectionLost] = React.useState<string | null>(
    null,
  );
  const [joinAttempt, setJoinAttempt] = React.useState(0);

  const handleError = React.useCallback(
    (error: Error) => {
      const failure = MediaDeviceFailure.getFailure(error);
      if (failure) {
        setMicError(describeMicFailure(messages, failure));
        return;
      }
      setConnectionLost(t(messages, "interview.couldntReach"));
    },
    [messages],
  );

  const handleMediaDeviceFailure = React.useCallback(
    (failure?: MediaDeviceFailure) => {
      setMicError(describeMicFailure(messages, failure));
    },
    [messages],
  );

  const handleDisconnected = React.useCallback(
    (reason?: DisconnectReason) => {
      // Intentional leave: navigation follows, not an error.
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      // The coach worker closed the room (soft cap / guard / its own end):
      // the session transcript is already persisted server-side; go home.
      if (reason === DisconnectReason.ROOM_DELETED) {
        router.push(returnHref);
        return;
      }
      setConnectionLost(t(messages, "interview.connDropped"));
    },
    [router, messages, returnHref],
  );

  function rejoin() {
    setMicError(null);
    setConnectionLost(null);
    setJoinAttempt((n) => n + 1);
  }

  const canConnect = Boolean(token && url);

  if (!canConnect) return <PreviewCoach persona={persona} />;
  if (!mounted) return <ConnectingCoach persona={persona} />;
  if (connectionLost) {
    return (
      <LostCoach persona={persona} message={connectionLost} onRejoin={rejoin} returnHref={returnHref} />
    );
  }

  return (
    <LiveKitRoom
      key={joinAttempt}
      serverUrl={url ?? undefined}
      token={token ?? undefined}
      connect
      audio
      video={false}
      data-session={sessionId}
      onError={handleError}
      onMediaDeviceFailure={handleMediaDeviceFailure}
      onDisconnected={handleDisconnected}
    >
      <RoomAudioRenderer />
      <CoachSession persona={persona} sessionId={sessionId} run={run} targets={targets} returnHref={returnHref} micError={micError} onMicError={setMicError} />
    </LiveKitRoom>
  );
}
