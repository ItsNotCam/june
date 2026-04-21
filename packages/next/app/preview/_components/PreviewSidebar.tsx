// author: Claude
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type NavItem = {
  label: string;
  icon: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
};

type NavSection = {
  heading: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", icon: "◈" },
      { label: "Activity", icon: "◎", badge: "6", badgeVariant: "secondary" },
      { label: "Alerts", icon: "◬", badge: "1", badgeVariant: "destructive" },
    ],
  },
  {
    heading: "Knowledge",
    items: [
      { label: "Sources", icon: "◷" },
      { label: "Embeddings", icon: "⬡" },
      { label: "Chunks", icon: "◰" },
      { label: "Re-index", icon: "↻" },
    ],
  },
  {
    heading: "Queries",
    items: [
      { label: "Live stream", icon: "◉" },
      { label: "History", icon: "◫" },
      { label: "Saved", icon: "◈" },
    ],
  },
  {
    heading: "Settings",
    items: [
      { label: "API keys", icon: "◌" },
      { label: "Models", icon: "◍" },
      { label: "Webhooks", icon: "⬡" },
      { label: "Team", icon: "◎" },
    ],
  },
];

const SYSTEM_STATUS = [
  { label: "Embed service", status: "error" as const },
  { label: "Query API", status: "ok" as const },
  { label: "Cache layer", status: "warn" as const },
  { label: "Ingest queue", status: "ok" as const },
];

const STATUS_DOT: Record<"ok" | "warn" | "error", string> = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
};

/** Collapsible sidebar for the preview page — fake nav content only. */
export function PreviewSidebar() {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState("Dashboard");

  return (
    <aside
      className={`
        relative flex flex-col shrink-0 border-r bg-card transition-all duration-200
        ${open ? "w-56" : "w-12"}
      `}
    >
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className="absolute -right-3.5 top-4 z-10 size-7 rounded-full border bg-card shadow-sm"
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        <span className="text-xs text-muted-foreground">{open ? "‹" : "›"}</span>
      </Button>

      <div className="flex flex-col h-full overflow-hidden">
        {/* Logo area */}
        <div className="flex items-center gap-2 border-b px-3 py-4 shrink-0">
          <span className="text-lg font-bold leading-none shrink-0">◈</span>
          {open && <span className="font-bold tracking-tight truncate">june.</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-4 px-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading} className="space-y-0.5">
              {open && (
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section.heading}
                </p>
              )}
              {section.items.map((item) => (
                <button
                  key={item.label}
                  onClick={() => setActive(item.label)}
                  className={`
                    flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors
                    ${active === item.label
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                    }
                    ${open ? "" : "justify-center"}
                  `}
                  title={open ? undefined : item.label}
                >
                  <span className="shrink-0 text-base leading-none">{item.icon}</span>
                  {open && (
                    <>
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.badge !== undefined && (
                        <Badge variant={item.badgeVariant ?? "secondary"} className="text-[10px] px-1.5 py-0 h-4">
                          {item.badge}
                        </Badge>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* System status footer */}
        {open && (
          <div className="shrink-0 border-t px-3 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              System
            </p>
            {SYSTEM_STATUS.map(({ label, status }) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
                <span className="text-xs text-muted-foreground truncate">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
