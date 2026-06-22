"use client";

import { useTheme } from "@/lib/theme";
import Switch from "@/components/ui/sky-toggle";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <Switch
      checked={isDark}
      onChange={toggle}
      size={14}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
    />
  );
}
