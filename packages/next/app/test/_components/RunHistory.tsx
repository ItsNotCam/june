"use client";
// author: Claude
/**
 * Run history list. Fetches `/test/api/runs` on mount and whenever `refreshKey`
 * changes. Each row expands to a `<RunDetail>` (timeline, metrics, report, logs).
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { RunDetail } from "./RunDetail";
import type { DiskRunStatus, RunListItem } from "@/lib/test/run-store";

const STATUS_VARIANT: Record<DiskRunStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  running: "secondary",
  completed: "default",
  aborted: "destructive",
  incomplete: "outline",
  empty: "outline",
};

const formatTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export function RunHistory({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<RunListItem[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/test/api/runs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { runs: RunListItem[] };
      setRuns(body.runs);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = useCallback(
    async (runId: string) => {
      if (!window.confirm(`Delete run ${runId}? This cannot be undone.`)) return;
      setDeleting(runId);
      try {
        const res = await fetch(`/test/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setExpanded((cur) => (cur === runId ? undefined : cur));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete run");
      } finally {
        setDeleting(undefined);
      }
    },
    [load],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Run history</span>
          {runs ? (
            <span className="text-muted-foreground text-xs font-normal">{runs.length} runs</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {runs && runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet.</p>
        ) : null}
        {runs?.map((run) => {
          const isOpen = expanded === run.runId;
          return (
            <div key={run.runId} className="border-border rounded-lg border">
              <div className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg pr-2 transition-colors">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? undefined : run.runId)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-xs">{run.runId}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatTime(run.completedAt ?? run.startedAt)}
                      {run.fixtureId ? ` · ${run.fixtureId}` : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {run.stagesComplete}/{run.totalStages}
                      {run.costUsd !== undefined ? ` · $${run.costUsd.toFixed(4)}` : ""}
                    </span>
                    <Badge variant={STATUS_VARIANT[run.status]}>{run.runStatusRaw ?? run.status}</Badge>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void remove(run.runId)}
                  disabled={run.status === "running" || deleting === run.runId}
                  aria-label={`Delete run ${run.runId}`}
                  title="Delete run"
                  className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                >
                  <span className="text-sm leading-none">{deleting === run.runId ? "…" : "🗑"}</span>
                </Button>
              </div>
              {isOpen ? (
                <div className="border-border border-t px-3 py-3">
                  <RunDetail runId={run.runId} />
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
