"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isLight = theme === "light";

  return (
    <button
      onClick={toggle}
      title={`Switch to ${isLight ? "dark" : "light"} theme`}
      aria-label="Toggle theme"
      className="relative w-9 h-9 rounded-lg bg-bg-elev-2 border border-border text-text-dim hover:bg-bg-elev hover:border-accent hover:text-accent transition-all duration-200 overflow-hidden flex items-center justify-center"
    >
      {/* Moon (dark mode) */}
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={`absolute transition-all duration-400 ${
          isLight ? "-translate-y-5 -rotate-90 opacity-0" : "translate-y-0 rotate-0 opacity-100"
        }`}
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      {/* Sun (light mode) */}
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={`absolute transition-all duration-400 ${
          isLight ? "translate-y-0 rotate-0 opacity-100" : "translate-y-5 rotate-90 opacity-0"
        }`}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
  );
}
