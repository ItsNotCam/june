"use client";
// author: Claude
/**
 * Per-run detail, lazily fetched from `/test/api/runs/:runId` when a history row
 * is expanded. Shows the stage timeline (artifact presence), headline metrics,
 * the summary.md report, and the saved event log + stderr when present.
 */
import { useEffect, useState } from "react";
import { Markdown } from "@/components/shadcn/markdown";
import type { RunDetail as RunDetailData } from "@/lib/test/run-store";
import type { TestEvent } from "@/lib/test/events";

const pct = (n?: number): string => (n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);
const num = (n?: number): string => (n === undefined ? "—" : n.toFixed(3));

const eventLine = (e: TestEvent): string => {
  switch (e.type) {
    case "run_start":
      return `run_start ${e.run_id} (${e.stages.length} stages)`;
    case "stage_start":
      return `stage_start ${e.stage} ${e.name}${e.total !== undefined ? ` total=${e.total}` : ""}`;
    case "tick":
      return `tick ${e.stage} ${e.done}/${e.total}`;
    case "poll":
      return `poll ${e.stage} ${Math.round(e.elapsed_ms / 1000)}s status=${e.status}`;
    case "stage_end":
      return `stage_end ${e.stage} ${e.name} ${Math.round(e.duration_ms)}ms`;
    case "run_complete":
      return `run_complete cost=$${e.cost_usd.toFixed(4)}`;
    case "run_error":
      return `run_error ${e.name}: ${e.message}`;
  }
};

export function RunDetail({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetailData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/test/api/runs/${encodeURIComponent(runId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { detail: RunDetailData };
        if (!cancelled) setDetail(body.detail);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load detail");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!detail) return <p className="text-muted-foreground text-sm">Loading…</p>;

  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* Stage timeline (left) + metrics (right) */}
      <div className="flex items-start gap-4">
        <div className="flex flex-1 flex-wrap content-start gap-1.5">
          {detail.stages.map((s) => (
            <span
              key={s.num}
              className={`rounded-md px-2 py-0.5 text-xs ${
                s.done ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}
              title={s.done ? "complete" : "not reached"}
            >
              {s.num}. {s.name}
            </span>
          ))}
        </div>

        {detail.metrics ? (
          <table className="w-1/2 shrink-0 text-xs">
            <tbody className="divide-border divide-y">
            <tr title="Share of questions the reader answered correctly from the retrieved sources.">
              <td className="text-muted-foreground py-1.5 pr-4">answers correct</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{pct(detail.metrics.readerCorrectPct)}</td>
            </tr>
            <tr title="How often the correct source was among the top 5 retrieved results.">
              <td className="text-muted-foreground py-1.5 pr-4">correct source in top 5</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{pct(detail.metrics.recallAt5)}</td>
            </tr>
            <tr title="How high the correct source ranks on average. 1.0 = always first; 0.5 ≈ second; lower = buried further down.">
              <td className="text-muted-foreground py-1.5 pr-4">avg ranking of correct source</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{num(detail.metrics.mrr)}</td>
            </tr>
            {detail.costUsd !== undefined ? (
              <tr>
                <td className="text-muted-foreground py-1.5 pr-4">cost</td>
                <td className="py-1.5 text-right font-medium tabular-nums">${detail.costUsd.toFixed(4)}</td>
              </tr>
            ) : null}
          </tbody>
          </table>
        ) : null}
      </div>

      {/* Saved log + stderr (collapsible) */}
      {detail.events || detail.stderr ? (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-primary text-xs hover:underline"
          >
            {showLog ? "Hide" : "Show"} log
            {detail.events ? ` (${detail.events.length} events)` : ""}
          </button>
          {showLog ? (
            <div className="mt-2 flex flex-col gap-2">
              {detail.events ? (
                <pre className="bg-muted text-muted-foreground max-h-64 overflow-auto rounded-md p-2 text-xs">
                  {detail.events.map(eventLine).join("\n")}
                </pre>
              ) : null}
              {detail.stderr ? (
                <pre className="bg-muted text-muted-foreground max-h-64 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
                  {detail.stderr}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* summary.md report */}
      {detail.summaryMd ? (
        <details>
          <summary className="text-primary cursor-pointer text-xs hover:underline">
            Summary report
          </summary>
          <div className="bg-muted text-foreground mt-2 max-h-96 overflow-auto rounded-md p-3 text-xs">
            <Markdown>{detail.summaryMd}</Markdown>
          </div>
        </details>
      ) : (
        <p className="text-muted-foreground text-xs">No summary.md (run did not reach scoring).</p>
      )}
    </div>
  );
}
