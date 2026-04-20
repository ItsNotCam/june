/**
 * stderr progress reporter ([§27.4](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#274-progress-output)).
 *
 * Prints one line per document-stage transition. Computes a rolling-average
 * ETA after the first 5 documents. No terminal-control codes — survives log
 * capture, pipes, and non-interactive shells.
 *
 * Callers construct one `ProgressReporter` per run (ingest / reconcile /
 * re-embed). `--quiet` swaps in a no-op instance so the same call sites don't
 * branch on the flag.
 */

export type Stage =
  | "parsed"
  | "chunked"
  | "contextualized"
  | "embedded"
  | "stored";

export type ProgressReporter = {
  start: (total: number) => void;
  tick: (source_uri: string, stage: Stage, extra?: string) => void;
  doc_done: (source_uri: string, duration_ms: number) => void;
  doc_skipped: (source_uri: string, reason: string) => void;
  doc_errored: (source_uri: string, message: string) => void;
  close: () => void;
};

type State = {
  total: number;
  current_idx: number;
  started_at: number;
  docsSeen: number;
  rollingAvg: number;
};

const formatEta = (secs: number): string => {
  if (!isFinite(secs) || secs <= 0) return "--";
  if (secs < 60) return `~${Math.round(secs)}s`;
  const m = Math.round(secs / 60);
  return `~${m}m`;
};

const ETA_SAMPLE_AFTER = 5;

const write = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * Default (human-readable) reporter. Emits one line per stage tick to stderr.
 * Designed to be readable in both interactive shells and plain log capture.
 */
export const createProgressReporter = (): ProgressReporter => {
  const s: State = {
    total: 0,
    current_idx: 0,
    started_at: performance.now(),
    docsSeen: 0,
    rollingAvg: 0,
  };
  return {
    start: (total) => {
      s.total = total;
      s.current_idx = 0;
      s.started_at = performance.now();
      s.docsSeen = 0;
      s.rollingAvg = 0;
    },
    tick: (source_uri, stage, extra) => {
      // Advance the numeric counter when we see the first stage marker for a
      // new doc (i.e. "parsed" is the first tick per document).
      if (stage === "parsed") s.current_idx++;
      const prefix = `[${s.current_idx}/${s.total || "?"}] ${source_uri}`;
      const suffix = extra ? ` (${extra})` : "";
      write(`${prefix}  ${stage}${suffix}`);
    },
    doc_done: (source_uri, duration_ms) => {
      s.docsSeen++;
      s.rollingAvg =
        s.rollingAvg === 0
          ? duration_ms
          : s.rollingAvg * 0.7 + duration_ms * 0.3;
      const remaining = Math.max(0, s.total - s.current_idx);
      let etaLine = "";
      if (s.docsSeen >= ETA_SAMPLE_AFTER && remaining > 0) {
        const etaSecs = (remaining * s.rollingAvg) / 1000;
        etaLine = `  ETA: ${remaining} docs remaining, est. ${formatEta(etaSecs)}`;
      }
      write(`[${s.current_idx}/${s.total || "?"}] ${source_uri}  done in ${Math.round(duration_ms)}ms${etaLine}`);
    },
    doc_skipped: (source_uri, reason) => {
      write(`[${s.current_idx}/${s.total || "?"}] ${source_uri}  skipped (${reason})`);
    },
    doc_errored: (source_uri, message) => {
      write(`[${s.current_idx}/${s.total || "?"}] ${source_uri}  errored (${message})`);
    },
    close: () => {
      // Nothing to flush — we write line-by-line.
    },
  };
};

/** No-op reporter for `--quiet` / `--json-log` modes. */
export const createSilentReporter = (): ProgressReporter => ({
  start: () => {},
  tick: () => {},
  doc_done: () => {},
  doc_skipped: () => {},
  doc_errored: () => {},
  close: () => {},
});
