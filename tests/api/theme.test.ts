import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseTheme, themeScript, THEME_STORAGE_KEY } from "@/lib/theme";

describe("theme before first paint", () => {
  it.each([
    [null, false, "light"],
    [null, true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["invalid", true, "dark"],
  ])("resolves preference %s with system dark=%s to %s", (saved, systemDark, expected) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeScript, {
      document,
      localStorage: { getItem: (key: string) => { expect(key).toBe(THEME_STORAGE_KEY); return saved; } },
      matchMedia: () => ({ matches: systemDark }),
    });
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it("respects the system when storage is blocked", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeScript, {
      document,
      localStorage: { getItem: () => { throw new Error("Storage blocked"); } },
      matchMedia: () => ({ matches: true }),
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("treats missing or unrecognized preferences as system", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("invalid")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });
});
