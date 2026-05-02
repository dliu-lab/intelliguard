"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "intelliguard-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function readInitialTheme(): Theme {
  const storedTheme = localStorage.getItem(STORAGE_KEY);

  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return "dark";
}

export function ThemeToggle({
  compact = false,
  tone = "default",
}: {
  compact?: boolean;
  tone?: "default" | "banner";
} = {}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const initialTheme = readInitialTheme();

    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  const buttonClass =
    tone === "banner"
      ? "grid h-9 w-9 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#2bd4aa]/45"
      : compact
        ? "grid h-10 w-10 place-items-center rounded-xl text-textSecondary transition hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/45"
        : "grid h-10 w-10 place-items-center rounded-full border border-line bg-white/[0.04] text-textSecondary transition hover:border-accent/50 hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/45";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={buttonClass}
    >
      {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
