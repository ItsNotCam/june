// author: Claude
/**
 * `GET /test/api/runs/:runId` — full detail for one run (stage timeline,
 * metrics, summary.md, saved event log + stderr). 404 if the run-dir is absent.
 * `DELETE /test/api/runs/:runId` — removes the run-dir; 409 while it is running.
 */
import { deleteRun, getRunDetail } from "@/lib/test/run-store";
import { runManager } from "@/lib/test/run-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const detail = await getRunDetail(runId);
  if (!detail) return Response.json({ error: "Run not found" }, { status: 404 });

  const live = runManager.getSnapshot();
  const overlaid =
    live.status === "running" && live.runId === runId
      ? { ...detail, status: "running" as const }
      : detail;
  return Response.json({ detail: overlaid });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;

  const live = runManager.getSnapshot();
  if (live.status === "running" && live.runId === runId) {
    return Response.json({ error: "Cannot delete a running run" }, { status: 409 });
  }

  const deleted = await deleteRun(runId);
  if (!deleted) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ deleted: runId });
}
