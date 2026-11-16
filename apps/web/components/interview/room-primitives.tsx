"use client";

/**
 * Shared voice-room primitives extracted from live-room.tsx so the study-coach
 * room renders the identical failure chrome instead of duplicating it.
 */

import * as React from "react";

import { cn } from "@/lib/cn";

/**
 * Accessible failure banner for the room scaffold's notice slot.
 * `role="alert"` + assertive aria-live so screen readers announce it the
 * moment it appears.
 */
export function ErrorNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "mx-auto mt-6 w-full max-w-xl rounded-card border border-accent/40",
        "bg-paper/80 px-4 py-3 text-center backdrop-blur-sm",
      )}
    >
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        {message}
      </p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * True when the room has been connected for `afterMs` and the agent has NEVER
 * joined it.
 *
 * The voice workers are separate processes, so a correctly-configured browser
 * can join a room that no agent is listening on. LiveKit reports that as a
 * perfectly healthy connection — the room is up, the mic works, nothing
 * errors — and the stage sits on "Connecting…" indefinitely with nothing to
 * act on (issue #67; the coach room has the exact same failure shape when the
 * coach worker isn't running).
 *
 * "Never" is deliberate: tracked with a ref so a mid-session blip, or the
 * agent leaving at the end, can't retroactively raise a "didn't join" notice.
 */
export function useAgentNeverJoined(
  connected: boolean,
  agentPresent: boolean,
  afterMs = 20_000,
) {
  const everJoined = React.useRef(false);
  const [waitedTooLong, setWaitedTooLong] = React.useState(false);

  if (agentPresent) everJoined.current = true;

  React.useEffect(() => {
    if (!connected || everJoined.current) return;
    const t = setTimeout(() => setWaitedTooLong(true), afterMs);
    return () => clearTimeout(t);
  }, [connected, afterMs]);

  return waitedTooLong && !everJoined.current;
}
