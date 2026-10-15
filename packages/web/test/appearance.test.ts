import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, displayTimestamp, parseAppearance, preferredScrollBehavior, updateAppearance } from "../src/appearance";
afterEach(() => { updateAppearance(DEFAULT_APPEARANCE); vi.unstubAllGlobals(); });
describe("browser appearance preferences", () => {
  it("recovers defaults from missing, corrupt, or invalid stored values", () => {
    for (const raw of [null, "{", "[]", "true", '{"density":"tiny","relativeTimes":"false","codeSize":999}']) expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });
  it("retains valid preferences independently of invalid fields", () => {
    expect(parseAppearance('{"density":"spacious","relativeTimes":false,"reduceMotion":true,"codeSize":16}')).toEqual({ density: "spacious", relativeTimes: false, reduceMotion: true, codeSize: 16 });
    expect(parseAppearance('{"density":"compact","codeSize":"16"}')).toEqual({ ...DEFAULT_APPEARANCE, density: "compact" });
  });
  it("formats absolute timestamps consistently in UTC and leaves invalid dates empty", () => {
    expect(displayTimestamp("2026-10-15T12:00:00+02:00", false)).toBe("2026-10-15 10:00:00 UTC");
    expect(displayTimestamp("2026-10-15T10:00:00Z", true, Date.parse("2026-10-15T10:02:30Z"))).toBe("2m 30s ago");
    expect(displayTimestamp(null, true)).toBe("—");
    expect(displayTimestamp("invalid", false)).toBe("—");
  });
  it("merges preference edits in storage without dropping previous choices", () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", { setItem: (key: string, value: string) => saved.set(key, value) });
    updateAppearance({ density: "compact" }); updateAppearance({ codeSize: 16, relativeTimes: false });
    expect(JSON.parse(saved.get(APPEARANCE_KEY)!)).toEqual({ ...DEFAULT_APPEARANCE, density: "compact", codeSize: 16, relativeTimes: false });
  });
  it("supports motion changes even when storage is blocked and respects the device preference", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("Storage denied"); } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(() => updateAppearance({ reduceMotion: true })).not.toThrow();
    expect(preferredScrollBehavior()).toBe("instant");
    updateAppearance({ reduceMotion: false }); expect(preferredScrollBehavior()).toBe("smooth");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(preferredScrollBehavior()).toBe("instant");
  });
});
