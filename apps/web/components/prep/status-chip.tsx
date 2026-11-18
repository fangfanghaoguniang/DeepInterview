"use client";

import { cn } from "@/lib/cn";
import { t, type Dictionary } from "@/lib/i18n";
import { useMessages } from "@/lib/i18n/client";
import type { MasteryState } from "@/lib/sample-mastery";

/**
 * Shared visual language for a competency's mastery state, used by the study
 * plan chips and (via the same palette) the mastery-graph nodes:
 *   unseen   → faint / neutral
 *   learning → accent-soft (indigo, the one accent)
 *   shaky    → warn amber (the single warm tone in the palette; inline hex
 *              since there is no `amber` token — kept tasteful and low-chroma)
 *   mastered → ok green
 */
export const MASTERY_LABEL: Record<MasteryState, string> = {
  unseen: "Not started",
  learning: "Learning",
  shaky: "Shaky",
  mastered: "Mastered",
};

/** Stable iteration order for legends/labels (replaces Object.keys on the map). */
export const MASTERY_STATES: readonly MasteryState[] = [
  "unseen",
  "learning",
  "shaky",
  "mastered",
];

/** Localized label for a mastery state (dictionary-backed). */
export function masteryLabel(m: Dictionary, state: MasteryState): string {
  switch (state) {
    case "unseen":
      return t(m, "prep.masteryUnseen");
    case "learning":
      return t(m, "prep.masteryLearning");
    case "shaky":
      return t(m, "prep.masteryShaky");
    case "mastered":
      return t(m, "prep.masteryMastered");
  }
}

/** Token/hex pairs for the four states, so node + chip stay in sync. */
export const MASTERY_COLORS: Record<
  MasteryState,
  { bg: string; fg: string; border: string }
> = {
  unseen: { bg: "#f4f3ef", fg: "#6b6b66", border: "#e6e4df" },
  learning: { bg: "#eef1ff", fg: "#3d4ab8", border: "#dde3ff" },
  shaky: { bg: "#fbf2e6", fg: "#b4690e", border: "#efddc2" },
  mastered: { bg: "#e8f3ec", fg: "#1f7a5c", border: "#cfe6d6" },
};

export function StatusChip({
  state,
  className,
}: {
  state: MasteryState;
  className?: string;
}) {
  const m = useMessages();
  const c = MASTERY_COLORS[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
        "text-[11px] font-mono font-medium",
        className,
      )}
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.border }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: c.fg }}
        aria-hidden
      />
      {masteryLabel(m, state)}
    </span>
  );
}
