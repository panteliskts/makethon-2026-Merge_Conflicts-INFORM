"use client";

import { useTheme } from "next-themes";
import { useLocale } from "@/lib/useLocale";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-8 h-8" />;

  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      className="pressable focus-ring w-8 h-8 rounded-md border border-card-border bg-card flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
    >
      {isDark ? (
        /* sun */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
      ) : (
        /* moon */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

export function LangToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      onClick={() => setLocale(locale === "en" ? "el" : "en")}
      aria-label="Switch language"
      className="pressable focus-ring h-8 px-2.5 rounded-md border border-card-border bg-card text-xs font-bold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
    >
      {locale === "en" ? "ΕΛ" : "EN"}
    </button>
  );
}
