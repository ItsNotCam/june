"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";

const THEMES = ["light", "dark", "orange"] as const;
type Theme = (typeof THEMES)[number];

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "orange",
  orange: "light",
};

const ICON = {
  light: <Moon size={16} />,
  dark: <Flame size={16} />,
  orange: <Sun size={16} />,
};

const LABEL: Record<Theme, string> = {
  light: "Switch to dark mode",
  dark: "Switch to orange mode",
  orange: "Switch to light mode",
};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const theme = (THEMES.includes(resolvedTheme as Theme) ? resolvedTheme : "light") as Theme;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={LABEL[theme]}
      onClick={() => setTheme(NEXT_THEME[theme])}
    >
      {ICON[theme]}
    </Button>
  );
}
