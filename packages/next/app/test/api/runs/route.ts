// author: Claude
/**
 * `GET /test/api/runs` — list every run-dir on disk (newest first), overlaying
 * the live run's status so an in-flight run shows as "running".
 */
import { listRuns } from "@/lib/test/run-store";
import { runManager } from "@/lib/test/run-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const runs = await listRuns();
  const live = runManager.getSnapshot();
  const overlaid =
    live.status === "running" && live.runId
      ? runs.map((r) => (r.runId === live.runId ? { ...r, status: "running" as const } : r))
      : runs;
  return Response.json({ runs: overlaid });
}
