"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const EVENT = "interleaf-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    getSnapshot,
    () => "light" // server snapshot
  );

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("interleaf-theme", next);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return { theme, toggle };
}

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to Daylight theme" : "Switch to Dusk theme"}
      title={dark ? "Dusk" : "Daylight"}
      className="flex items-center gap-2 text-xs font-medium text-ink-soft hover:text-ink transition-colors"
    >
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full"
        style={{
          background: dark ? "oklch(0.70 0.06 250)" : "oklch(0.74 0.11 75)",
        }}
      />
      {dark ? "Dusk" : "Daylight"}
    </button>
  );
}
