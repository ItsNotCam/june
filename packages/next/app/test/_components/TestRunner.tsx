"use client";
// author: Claude
/**
 * Client UI for the single bench run.
 *
 * Opens an EventSource to `/test/api` on mount and renders entirely from the
 * latest snapshot the server sends — so a reload mid-run picks up current
 * progress (the server replays the snapshot on connect). The Start button POSTs
 * to the same route and is disabled while a run is live (and between click and
 * the first `running` snapshot) so it can only fire once per run.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunMessage, RunSnapshot, StageState } from "@/lib/test/events";

const STATUS_LABEL: Record<RunSnapshot["status"], string> = {
  idle: "Idle",
  running: "Running",
  completed: "Completed",
  error: "Error",
};

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
};

const stageBadgeVariant = (
  status: StageState["status"],
): React.ComponentProps<typeof Badge>["variant"] =>
  status === "done" ? "default" : status === "running" ? "secondary" : "outline";

function StageRow({ stage }: { stage: StageState }) {
  const hasTotal = stage.total !== undefined && stage.total > 0;
  const percent = hasTotal
    ? Math.round(((stage.done ?? 0) / stage.total!) * 100)
    : stage.status === "done"
      ? 100
      : 0;
  const indeterminate = stage.status === "running" && !hasTotal;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-foreground">
            {stage.num}. {stage.name}
          </span>
          <Badge variant={stageBadgeVariant(stage.status)}>{stage.status}</Badge>
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {hasTotal ? `${stage.done ?? 0}/${stage.total}` : ""}
          {stage.elapsedMs !== undefined ? ` · ${formatMs(stage.elapsedMs)}` : ""}
          {stage.detail ? ` · ${stage.detail}` : ""}
        </span>
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={`bg-primary h-full rounded-full transition-[width] duration-300 ${indeterminate ? "animate-pulse" : ""}`}
          style={{ width: indeterminate ? "100%" : `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function TestRunner({
  onStatusChange,
}: {
  /** Fired whenever the run's lifecycle status changes — used to refresh history. */
  onStatusChange?: (status: RunSnapshot["status"]) => void;
}) {
  const [snapshot, setSnapshot] = useState<RunSnapshot>({ status: "idle", stages: [] });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  // Bumped to (re)open the SSE stream — the server closes it on a terminal run,
  // so a fresh Start needs a new connection.
  const [connectNonce, setConnectNonce] = useState(0);

  useEffect(() => {
    const es = new EventSource("/test/api");
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as RunMessage;
      setSnapshot(msg.snapshot);
      // Server closes the stream on terminal; close our side so EventSource
      // doesn't auto-reconnect and re-open a fresh stream.
      if (msg.snapshot.status === "completed" || msg.snapshot.status === "error") {
        es.close();
      }
    };
    return () => es.close();
  }, [connectNonce]);

  // Clear the local "starting" latch once the server confirms the run is live.
  useEffect(() => {
    if (snapshot.status === "running") setStarting(false);
  }, [snapshot.status]);

  // Notify the parent on every status change so the history list stays fresh.
  useEffect(() => {
    onStatusChange?.(snapshot.status);
  }, [snapshot.status, onStatusChange]);

  const isRunning = snapshot.status === "running";

  const onStart = useCallback(async () => {
    setStarting(true);
    setStartError(undefined);
    // Reconnect the SSE stream if a previous run had ended (and closed it).
    setConnectNonce((n) => n + 1);
    try {
      const res = await fetch("/test/api", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStartError(body.error ?? `Failed to start (HTTP ${res.status})`);
        setStarting(false);
      }
      // On 202 (started) or 409 (already running) the SSE stream drives the UI.
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start run");
      setStarting(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Bench run</span>
            <Badge variant={snapshot.status === "error" ? "destructive" : "secondary"}>
              {STATUS_LABEL[snapshot.status]}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button onClick={onStart} disabled={isRunning || starting}>
              {isRunning ? "Running…" : starting ? "Starting…" : "Start test"}
            </Button>
            {snapshot.runId ? (
              <span className="text-muted-foreground font-mono text-xs">{snapshot.runId}</span>
            ) : null}
          </div>
          {startError ? <p className="text-destructive text-sm">{startError}</p> : null}
        </CardContent>
      </Card>

      {snapshot.stages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Stages</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {snapshot.stages.map((s) => (
              <StageRow key={s.num} stage={s} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {snapshot.status === "completed" ? (
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4 text-sm">
            <p className="text-success font-medium">Run complete</p>
            {snapshot.costUsd !== undefined ? (
              <p className="text-muted-foreground">Total cost: ${snapshot.costUsd.toFixed(4)}</p>
            ) : null}
            {snapshot.runDir ? (
              <p className="text-muted-foreground font-mono text-xs break-all">{snapshot.runDir}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {snapshot.status === "error" && snapshot.error ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-destructive mb-1 text-sm font-medium">Run failed</p>
            <pre className="text-muted-foreground overflow-x-auto text-xs whitespace-pre-wrap">
              {snapshot.error}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
