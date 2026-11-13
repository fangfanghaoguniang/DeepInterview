import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  getMessages,
  isLocale,
  type Dictionary,
  type Locale,
} from "./index";

/**
 * Server-component counterpart of `useMessages()`: resolves the `locale`
 * cookie on the server so landing/marketing components can render translated
 * copy without a client hook. Unset cookie resolves to DEFAULT_LOCALE, same
 * rule as the client readers in `client.ts` and the root layout.
 */
export async function getServerMessages(): Promise<Dictionary> {
  const store = await cookies();
  const value = store.get("locale")?.value;
  return getMessages(isLocale(value) ? value : DEFAULT_LOCALE);
}

/**
 * The resolved locale itself (not just the dictionary) — for picking the
 * language KEY inside multi-locale content like `PlannedQuestion.text`,
 * where translation happens upstream and the reader just selects.
 */
export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get("locale")?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
