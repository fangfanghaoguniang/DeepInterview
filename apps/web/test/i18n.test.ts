import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { vi } from "../lib/i18n/messages/vi";
import { zh } from "../lib/i18n/messages/zh";
import { DEFAULT_LOCALE, getMessages, isLocale, t } from "../lib/i18n";

/** Every string leaf path in `en`, e.g. ["nav.setup", "interview.end", ...]. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

describe("Vietnamese UI pack (issue #50)", () => {
  it("resolves `vi` to the real dictionary, not English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getMessages("vi")).toBe(vi);
    expect(getMessages("en")).toBe(en);
    // Spot-check: the pack is actually translated.
    expect(t(getMessages("vi"), "setup.start")).toBe("Bắt đầu phỏng vấn");
    expect(t(getMessages("vi"), "setup.start")).not.toBe(
      t(getMessages("en"), "setup.start"),
    );
  });

  it("covers every `en` key (parity is also enforced by tsc)", () => {
    const missing = leafPaths(en).filter((p) => t(vi, p) === p);
    expect(missing).toEqual([]);
  });

  it("falls back visibly for unknown keys", () => {
    expect(t(getMessages("vi"), "no.such.key")).toBe("no.such.key");
    expect(t(getMessages("en"), "no.such.key")).toBe("no.such.key");
  });
});

describe("Chinese UI pack", () => {
  it("resolves `zh` to the real dictionary, not English", () => {
    expect(getMessages("zh")).toBe(zh);
    // Spot-check: the pack is actually translated.
    expect(t(getMessages("zh"), "setup.start")).toBe("开始面试");
    expect(t(getMessages("zh"), "setup.start")).not.toBe(
      t(getMessages("en"), "setup.start"),
    );
  });

  it("covers every `en` key (parity is also enforced by tsc)", () => {
    const missing = leafPaths(en).filter((p) => t(zh, p) === p);
    expect(missing).toEqual([]);
  });

  it("preserves `{company}` placeholder in `setup.researching`", () => {
    // Callers `replace()` on this token; a translation that drops it would
    // silently remove the company name from the progress line.
    expect(t(getMessages("zh"), "setup.researching")).toContain("{company}");
  });
});

describe("isLocale cookie-reader guard", () => {
  it("accepts every supported locale and rejects unknown values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("vi")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});
