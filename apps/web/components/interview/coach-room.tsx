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
  notice,
}: {
  persona: Persona;
  stage: React.ReactNode;
  transcript: React.ReactNode;
  timer: React.ReactNode;
  controls: React.ReactNode;
  textFallback: React.ReactNode;
  notice?: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-paper">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 50% -10%, rgba(67,56,202,0.06), transparent 60%)",
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
  persona,
  micError,
  onMicError,
}: {
  persona: Persona;
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
  const { state: agentState } = useVoiceAssistant();
  const agentNeverJoined = useAgentNeverJoined(
    connected,
    agentState !== "disconnected",
  );

  const [ending, setEnding] = React.useState(false);

  // Push-to-talk + half-duplex: mic live only while recording; the converge
  // effect below is the single place track mute state is written.
  const [recording, setRecording] = React.useState(false);
  const [recordSeconds, setRecordSeconds] = React.useState(0);
  const room = useRoomContext();

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
      try {
        void room.localParticipant.publishData(
          new TextEncoder().encode("finish"),
          { topic: "finish_answer" },
        );
      } catch {
        // Not connected — there is no live turn to commit, safe to drop.
      }
    }
    prevRecording.current = recording;
  }, [recording, room]);

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
    if (!connected || !micAvailable || ending) return;
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
    setEnding(true);
    try {
      await localParticipant.setMicrophoneEnabled(false);
    } catch {
      // best-effort; proceed to leave regardless
    }
    // The coach's home is the prep page — that's where the study plan and the
    // cards it just talked about live. No report to route to.
    router.push("/prep");
  }

  function sendText(text: string) {
    setTypedTurns((prev) => [
      ...prev,
      { id: `typed-${Date.now()}-${prev.length}`, text, at: Date.now() },
    ]);
    void localParticipant
      .sendText(text, { topic: AGENT_CHAT_TOPIC })
      .catch(() => {
        // no-op if the room isn't ready
      });
  }

  return (
    <CoachFrame
      persona={persona}
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
            recordDisabled={!connected || !micAvailable || ending}
            recordSeconds={recordSeconds}
            onToggleRecord={toggleRecording}
          />
        </div>
      }
      textFallback={<TextFallback onSend={sendText} />}
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
  onRejoin,
}: {
  persona: Persona;
  message: string;
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
            href="/prep"
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

export function CoachRoom({ sessionId, persona, token, url }: CoachRoomProps) {
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
        router.push("/prep");
        return;
      }
      setConnectionLost(t(messages, "interview.connDropped"));
    },
    [router, messages],
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
      <LostCoach persona={persona} message={connectionLost} onRejoin={rejoin} />
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
      <CoachSession persona={persona} micError={micError} onMicError={setMicError} />
    </LiveKitRoom>
  );
}
