"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Select } from "@/components/select";

import { parseTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const ThemeContext = createContext<{
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
} | null>(null);

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    try {
      setPreference(parseTheme(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      setPreference("system");
    }
    const syncStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setPreference(parseTheme(event.newValue));
      }
    };
    window.addEventListener("storage", syncStorage);
    return () => window.removeEventListener("storage", syncStorage);
  }, []);

  useEffect(() => {
    if (preference === null) return;
    applyTheme(preference);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => applyTheme(preference);
    media.addEventListener("change", syncSystem);
    return () => media.removeEventListener("change", syncSystem);
  }, [preference]);

  function changePreference(value: ThemePreference) {
    applyTheme(value);
    setPreference(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // The choice still works for this visit when persistence is unavailable.
    }
  }

  return <ThemeContext.Provider value={{ preference: preference ?? "system", setPreference: changePreference }}>{children}</ThemeContext.Provider>;
}

export function ThemeSelect() {
  const theme = useContext(ThemeContext);
  if (!theme) return null;
  const Icon = theme.preference === "dark" ? Moon : theme.preference === "light" ? Sun : Monitor;

  return (
    <Select
      label="Color theme"
      value={theme.preference}
      onValueChange={(value) => theme.setPreference(parseTheme(value))}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
      icon={<Icon className="h-4 w-4 shrink-0" aria-hidden />}
      className="shrink-0 rounded-full border border-line-strong px-3 text-sm font-bold"
    />
  );
}
