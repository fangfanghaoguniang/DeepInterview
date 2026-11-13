import { en, type Localized, type Messages } from "./messages/en";
import { zh } from "./messages/zh";

/** Supported UI locales. This fork ships Chinese + English only. */
export type Locale = "en" | "zh";

/**
 * All supported locales, in the order the switcher shows them. Kept next to
 * the `Locale` union so adding a pack is one edit — the cookie readers
 * (`language-toggle`, `client.ts`, root layout) all derive from this list
 * instead of hard-coding binary `=== "xx" ? … : "en"` chains, which silently
 * reverted every unknown value to English and had to be updated per pack.
 */
export const LOCALES: readonly Locale[] = ["zh", "en"];

/** Type guard used by cookie readers. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Locale used when the `locale` cookie is unset. This fork is Chinese-first:
 * an unset cookie resolves to the CN pack, and `en` remains the fallback
 * dictionary for unknown/unresolvable values.
 */
export const DEFAULT_LOCALE: Locale = "zh";

/**
 * What message readers (`t()`, `useMessages()`) actually handle: the exact
 * `en` key structure with widened string values, so every locale pack fits.
 * `en`'s literals stay the parity anchor (`Messages`); packs are checked
 * against it at compile time in their own files.
 */
export type Dictionary = Localized<Messages>;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  zh,
};

/** Resolve the message dictionary for a locale (defaults to DEFAULT_LOCALE). */
export function getMessages(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return dictionaries[locale] ?? en;
}

/**
 * Read a dot-path key from a messages dictionary, e.g. `t(messages, "nav.setup")`.
 * Returns the key itself if the path is missing (visible-but-safe fallback).
 */
export function t(messages: Dictionary, key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
  return typeof value === "string" ? value : key;
}

export { en };
export type { Messages };
