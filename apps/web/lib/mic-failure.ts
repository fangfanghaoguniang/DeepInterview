/**
 * Shared mic-failure copy helper for the live voice rooms (interview + coach).
 *
 * Extracted verbatim from live-room.tsx so the coach room can explain a
 * blocked/missing/busy microphone with the same fix-it guidance instead of
 * duplicating the switch. Pure (dictionary in, string out) — no React, no
 * LiveKit client instance, only the static MediaDeviceFailure enum.
 */

import { MediaDeviceFailure } from "livekit-client";

import { t, type Dictionary } from "@/lib/i18n";

/**
 * Human, fixable guidance for a microphone failure. Permission denial is the
 * common case — the browser blocked getUserMedia — so we say exactly where to
 * flip the switch instead of a generic "something went wrong".
 */
export function describeMicFailure(
  messages: Dictionary,
  failure?: MediaDeviceFailure,
): string {
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return t(messages, "interview.micBlocked");
    case MediaDeviceFailure.NotFound:
      return t(messages, "interview.micNotFound");
    case MediaDeviceFailure.DeviceInUse:
      return t(messages, "interview.micInUse");
    default:
      return t(messages, "interview.micUnknown");
  }
}
