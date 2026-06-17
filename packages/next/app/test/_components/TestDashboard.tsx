"use client";
// author: Claude
/**
 * Client coordinator for the `/test` page: the live runner, config panel, and a
 * results-over-time chart stacked in the main column, with run history beside
 * them on wide screens and below on narrow ones. A status change in the live run
 * bumps `refreshKey` so the history and chart refetch (new run appears as
 * running; finished run shows its result).
 */
import { useCallback, useState } from "react";
import { TestRunner } from "./TestRunner";
import { RunHistory } from "./RunHistory";
import { ConfigPanel } from "./ConfigPanel";
import { ResultsChart } from "./ResultsChart";
import type { RunSnapshot } from "@/lib/test/events";

export function TestDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const onStatusChange = useCallback((status: RunSnapshot["status"]) => {
    setIsRunning(status === "running");
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex flex-1 flex-col gap-8 min-w-0">
        <TestRunner onStatusChange={onStatusChange} />
        <ConfigPanel disabled={isRunning} />
        <ResultsChart refreshKey={refreshKey} />
      </div>
      <div className="w-full lg:w-1/2 lg:shrink-0">
        <RunHistory refreshKey={refreshKey} />
      </div>
    </div>
  );
}
