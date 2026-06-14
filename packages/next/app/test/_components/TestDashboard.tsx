"use client";
// author: Claude
/**
 * Client coordinator for the `/test` page: the live runner on top, the run
 * history below. A status change in the live run bumps `refreshKey` so the
 * history refetches (new run appears as running; finished run shows its result).
 */
import { useCallback, useState } from "react";
import { TestRunner } from "./TestRunner";
import { RunHistory } from "./RunHistory";
import { ConfigPanel } from "./ConfigPanel";
import type { RunSnapshot } from "@/lib/test/events";

export function TestDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const onStatusChange = useCallback((status: RunSnapshot["status"]) => {
    setIsRunning(status === "running");
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <ConfigPanel disabled={isRunning} />
      <TestRunner onStatusChange={onStatusChange} />
      <RunHistory refreshKey={refreshKey} />
    </div>
  );
}
