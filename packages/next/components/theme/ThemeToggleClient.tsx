// author: Claude
"use client";

import dynamic from "next/dynamic";

const ThemeToggle = dynamic(() => import("./ThemeToggle").then(m => m.ThemeToggle), { ssr: false });

export function ThemeToggleClient() {
  return <ThemeToggle />;
}
