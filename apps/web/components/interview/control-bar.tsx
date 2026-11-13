"use client";

/**
 * <ControlBar> — the small, subtle live-interview controls (WP-2).
 *
 * Pure presentational: mute toggle + end-interview, driven entirely by props so
 * the LIVE container can wire real room controls and the PREVIEW container can
 * render the same chrome disabled. Restrained styling — a calm frosted bar.
 */

import { Mic, MicOff, PhoneOff } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { useMessages } from "@/lib/i18n/client";
import { t } from "@/lib/i18n";

export interface ControlBarProps {
  /** True when the mic is publishing; false when muted. */
  micEnabled: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
  /** Disable all controls (preview / not connected). */
  disabled?: boolean;
  /** True while the end action is in flight. */
  ending?: boolean;
  className?: string;
  /** Push-to-talk: true while the candidate's answer is being captured. */
  recording?: boolean;
  /** Disable the push-to-talk button (not connected / mic off / ending). */
  recordDisabled?: boolean;
  /** Whole seconds the current answer has been recording (live timer). */
  recordSeconds?: number;
  /** Start/stop recording. When omitted the push-to-talk button is not
   *  rendered, so preview/offline shells keep their original two-control chrome. */
  onToggleRecord?: () => void;
}

export function ControlBar({
  micEnabled,
  onToggleMute,
  onEnd,
  disabled = false,
  ending = false,
  className,
  recording = false,
  recordDisabled = false,
  recordSeconds = 0,
  onToggleRecord,
}: ControlBarProps) {
  const messages = useMessages();
  // Two-tap end: the first tap arms ("Tap again to end"), the second fires.
  // Ending an interview mid-call is irreversible, and End sits next to Mute.
  const [armed, setArmed] = React.useState(false);
  const armTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (armTimer.current != null) window.clearTimeout(armTimer.current);
    },
    [],
  );

  function handleEnd() {
    if (disabled || ending) return;
    if (!armed) {
      setArmed(true);
      if (armTimer.current != null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (armTimer.current != null) window.clearTimeout(armTimer.current);
    setArmed(false);
    onEnd();
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line",
        "bg-paper/80 p-1.5 backdrop-blur-md",
        className,
      )}
      role="group"
      aria-label={t(messages, "interview.controls")}
    >
      {onToggleRecord ? (
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={disabled || recordDisabled}
          aria-pressed={recording}
          aria-label={t(
            messages,
            recording ? "interview.finishAnswer" : "interview.startAnswer",
          )}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full px-4",
            "text-[13px] font-medium",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
            "disabled:opacity-40 disabled:pointer-events-none",
            recording
              ? "bg-accent text-white hover:bg-accent"
              : "bg-ink text-white hover:bg-ink-soft",
          )}
        >
          {recording ? (
            <>
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-white"
                aria-hidden
              />
              <span className="tabular-nums">{recordSeconds}s</span>
              <span>{t(messages, "interview.finishAnswer")}</span>
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" aria-hidden />
              <span>{t(messages, "interview.startAnswer")}</span>
            </>
          )}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onToggleMute}
        disabled={disabled}
        aria-pressed={!micEnabled}
        aria-label={
          micEnabled
            ? t(messages, "interview.mute")
            : t(messages, "interview.unmute")
        }
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-full",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "disabled:opacity-40 disabled:pointer-events-none",
          micEnabled
            ? "text-ink-soft hover:bg-accent-soft hover:text-ink"
            : "bg-accent-soft text-accent",
        )}
      >
        {micEnabled ? (
          <Mic className="h-[18px] w-[18px]" aria-hidden />
        ) : (
          <MicOff className="h-[18px] w-[18px]" aria-hidden />
        )}
      </button>

      <button
        type="button"
        onClick={handleEnd}
        onBlur={() => setArmed(false)}
        disabled={disabled || ending}
        aria-label={
          armed
            ? t(messages, "interview.confirmEnd")
            : t(messages, "interview.end")
        }
        aria-live="polite"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full px-4",
          "text-[13px] font-medium",
          armed
            ? "bg-accent text-white hover:bg-accent"
            : "bg-ink text-white hover:bg-ink-soft",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "disabled:opacity-40 disabled:pointer-events-none",
        )}
      >
        <PhoneOff className="h-4 w-4" aria-hidden />
        {ending
          ? t(messages, "interview.ending")
          : armed
            ? t(messages, "interview.confirmEnd")
            : t(messages, "interview.endButton")}
      </button>
    </div>
  );
}
