// author: Claude
/**
 * The reader-by-purpose contract — the single, committed source of truth for
 * which reader model each run mode uses. It lives in code (NOT the gitignored
 * `config.yaml`) precisely so the flash↔gemma discipline cannot be silently
 * edited away.
 *
 * - `iterate`  → `deepseek-v4-flash` (hosted, fast). The scratchpad. Directional
 *   signal ONLY — flash numbers are NEVER "expected results."
 * - `control`  → `gemma4:26b` (local Ollama). The bar. The only runs that define
 *   expected results / regression verdicts.
 * - `freeform` → an explicit `--reader-provider/--reader-model` run (e.g. a model
 *   bake-off). Never a baseline, never a control.
 *
 * `--mode` FORCES the reader, so a `control` run cannot use the wrong model.
 * See `packages/mcp/bench/CLAUDE.md` for the full workflow rule.
 */
export type ReaderProvider = "ollama" | "anthropic" | "openai" | "deepseek";

/** How a run declares its intent. Stamped into the run manifest. */
export type RunMode = "iterate" | "control" | "freeform";

export type ReaderRef = { provider: ReaderProvider; model: string };

/** The disciplined modes that pin a fixed reader. `freeform` has none. */
export const RUN_MODES: Record<"iterate" | "control", ReaderRef> = {
  iterate: { provider: "deepseek", model: "deepseek-v4-flash" },
  control: { provider: "ollama", model: "gemma4:26b" },
};

/**
 * True only for the authoritative reference reader — the sole reader whose runs
 * define the bar. Used to assert `mode==="control" ⟺ reader is gemma4:26b`.
 */
export const isControlReader = (r: ReaderRef): boolean =>
  r.provider === RUN_MODES.control.provider && r.model === RUN_MODES.control.model;
