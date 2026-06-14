// author: Claude
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type NavItem = {
  label: string;
  icon: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: "◈", href: "/" },
  { label: "Ingest", icon: "↥", href: "/ingest" },
  { label: "Test", icon: "▦", href: "/test" },
];

/**
 * Real app sidebar mounted in the root layout — persists across navigation
 * (App Router layouts don't remount). Active state derives from the pathname.
 * Styling mirrors the preview page's sidebar so the chrome stays consistent.
 */
export function SideNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className={`
        relative flex flex-col shrink-0 border-r bg-card transition-all duration-200
        ${open ? "w-56" : "w-12"}
      `}
    >
      {/* Collapse toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className="absolute -right-3.5 top-4 z-10 size-7 rounded-full border bg-card shadow-sm"
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        <span className="text-xs text-muted-foreground">{open ? "‹" : "›"}</span>
      </Button>

      <div className="flex h-full flex-col overflow-hidden">
        {/* Logo area */}
        <Link
          href="/"
          className="flex items-center gap-2 border-b px-3 py-4 shrink-0 hover:bg-muted/50 transition-colors"
        >
          <span className="text-lg font-bold leading-none shrink-0">◈</span>
          {open && <span className="font-bold tracking-tight truncate">june.</span>}
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={open ? undefined : item.label}
                className={`
                  flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors
                  ${active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                  }
                  ${open ? "" : "justify-center"}
                `}
              >
                <span className="shrink-0 text-base leading-none">{item.icon}</span>
                {open && <span className="flex-1 truncate text-left">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
