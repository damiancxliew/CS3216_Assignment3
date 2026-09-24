export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "historical-adventures-theme";

export function parseTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

// Runs in the head before the page paints. Storage may be unavailable in private
// browsing; in that case we still respect the device's color scheme.
export const themeScript = `(() => {
  let preference = "system";
  try { preference = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) || "system"; } catch {}
  const dark = preference === "dark" || (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();`;
