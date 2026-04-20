"use client";

import { useState, useCallback } from "react";
import { Palette, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_H = 120;
const DEFAULT_S = 18;
const DEFAULT_L = 35;

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

/**
 * Pushes all primary-family CSS variables onto :root so every token that
 * derives from --primary updates live without a page reload.
 */
function applyPrimaryColor(h: number, s: number, l: number): void {
  const el = document.documentElement;
  el.style.setProperty("--primary", hsl(h, s, l));
  el.style.setProperty("--primary-hover", hsl(h, s, Math.max(0, l - 7)));
  el.style.setProperty("--ring", hsl(h, s, l));
  el.style.setProperty("--accent-foreground", hsl(h, s, l));
  el.style.setProperty("--sidebar-primary", hsl(h, s, l));
  el.style.setProperty("--accent", hsl(h, Math.round(s * 0.35), Math.min(96, l + 22)));
  el.style.setProperty("--chart-1", hsl(h, s, l));
  el.style.setProperty("--chart-2", hsl(h, Math.round(s * 0.8), Math.min(96, l + 12)));
  el.style.setProperty("--chart-3", hsl(h, Math.round(s * 0.55), Math.min(96, l + 24)));
  el.style.setProperty("--success", hsl(h, Math.min(100, Math.round(s * 1.4)), Math.min(96, l + 18)));
}

function resetPrimaryColor(): void {
  const el = document.documentElement;
  const vars = [
    "--primary", "--primary-hover", "--ring", "--accent-foreground",
    "--sidebar-primary", "--accent", "--chart-1", "--chart-2", "--chart-3", "--success",
  ];
  for (const v of vars) el.style.removeProperty(v);
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  gradient: string;
  display: string;
  onChange: (v: number) => void;
};

function HslSlider({ label, value, min, max, gradient, display, onChange }: SliderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-medium text-foreground-subtle tracking-widest uppercase">{label}</span>
        <span className="text-[10px] font-mono text-foreground-muted tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hsl-picker-slider"
        style={{ background: gradient }}
      />
    </div>
  );
}

/**
 * Fixed FAB that expands into an HSL picker for the page's primary color family.
 * Completely self-contained — mounts anywhere, needs no props or context.
 */
export function HslColorPicker() {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(DEFAULT_H);
  const [s, setS] = useState(DEFAULT_S);
  const [l, setL] = useState(DEFAULT_L);

  const update = useCallback((newH: number, newS: number, newL: number) => {
    setH(newH);
    setS(newS);
    setL(newL);
    applyPrimaryColor(newH, newS, newL);
  }, []);

  const reset = useCallback(() => {
    setH(DEFAULT_H);
    setS(DEFAULT_S);
    setL(DEFAULT_L);
    resetPrimaryColor();
  }, []);

  const hGradient = `linear-gradient(to right, ${
    [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]
      .map((deg) => `hsl(${deg} ${s}% ${l}%)`)
      .join(", ")
  })`;
  const sGradient = `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`;
  const lGradient = `linear-gradient(to right, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))`;

  const isDefault = h === DEFAULT_H && s === DEFAULT_S && l === DEFAULT_L;

  return (
    <>
      {/* Scoped slider styles — must use pseudo-selectors so inline styles can't reach them */}
      <style>{`
        .hsl-picker-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }
        .hsl-picker-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(0,0,0,0.25);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
        .hsl-picker-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(0,0,0,0.25);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
      `}</style>

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {/* Expanded panel */}
        <div
          className={cn(
            "bg-card border border-border rounded-xl shadow-xl p-4 w-64 flex flex-col gap-3",
            "transition-all duration-200 origin-bottom-right",
            open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Primary Color</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={reset}
                disabled={isDefault}
                className="p-1 rounded text-foreground-subtle hover:text-foreground disabled:opacity-30 transition-colors"
                aria-label="Reset to default"
                title="Reset"
              >
                <RotateCcw size={13} />
              </button>
              {/* Live swatch */}
              <div
                className="w-5 h-5 rounded-full border border-border"
                style={{ background: hsl(h, s, l) }}
              />
            </div>
          </div>

          <HslSlider
            label="Hue"
            value={h}
            min={0}
            max={360}
            gradient={hGradient}
            display={`${h}°`}
            onChange={(v) => update(v, s, l)}
          />
          <HslSlider
            label="Saturation"
            value={s}
            min={0}
            max={100}
            gradient={sGradient}
            display={`${s}%`}
            onChange={(v) => update(h, v, l)}
          />
          <HslSlider
            label="Lightness"
            value={l}
            min={0}
            max={100}
            gradient={lGradient}
            display={`${l}%`}
            onChange={(v) => update(h, s, v)}
          />

          <p className="text-[10px] text-foreground-faint font-mono text-center pt-0.5">
            hsl({h} {s}% {l}%)
          </p>
        </div>

        {/* FAB */}
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "w-12 h-12 rounded-full shadow-lg flex items-center justify-center",
            "bg-primary text-primary-foreground",
            "hover:bg-primary-hover transition-all duration-200",
            open && "rotate-45",
          )}
          aria-label={open ? "Close color picker" : "Open color picker"}
        >
          {open ? <X size={20} /> : <Palette size={20} />}
        </button>
      </div>
    </>
  );
}
