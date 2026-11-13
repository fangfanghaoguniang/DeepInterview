"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  getMessages,
  isLocale,
  type Dictionary,
  type Locale,
} from "@/lib/i18n";

/**
 * Client-side message resolution. `getMessages` owns the locale → pack
 * registry (Chinese + English in this fork); this helper just resolves
 * whatever the `locale` cookie points at, falling back to DEFAULT_LOCALE.
 */
function resolve(locale: Locale): Dictionary {
  return getMessages(locale);
}

function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("locale="));
  const value = match?.split("=")[1];
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Resolve messages on the client from the `locale` cookie. Starts at
 * DEFAULT_LOCALE for a stable first paint, then re-resolves after mount
 * (avoids hydration drift).
 */
export function useMessages(): Dictionary {
  const [messages, setMessages] = useState<Dictionary>(() =>
    resolve(DEFAULT_LOCALE),
  );
  useEffect(() => {
    setMessages(resolve(readLocaleCookie()));
  }, []);
  return messages;
}

/**
 * The active locale from the `locale` cookie. Starts at EN for a stable first
 * paint, then re-resolves after mount (same hydration-safe pattern as
 * `useMessages`). Use it to route locale-dependent behavior (e.g. the language
 * the study coach answers in) to the user's chosen language.
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    setLocale(readLocaleCookie());
  }, []);
  return locale;
}
