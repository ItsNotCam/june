// author: Claude
/**
 * `/test/api/config` — the editable run configuration.
 *
 *   GET → the saved config (or shipped defaults if none saved yet).
 *   PUT → validate + persist a new config. 409 while a run is live (locked);
 *         400 with Zod issues on an invalid body.
 */
import { loadTestConfig, saveTestConfig } from "@/lib/test/config";
import { runManager } from "@/lib/test/run-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = await loadTestConfig();
  return Response.json({ config });
}

export async function PUT(request: Request): Promise<Response> {
  if (runManager.getSnapshot().status === "running") {
    return Response.json({ error: "Cannot edit config while a run is in progress" }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const config = await saveTestConfig(body);
    return Response.json({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid config";
    return Response.json({ error: message }, { status: 400 });
  }
}
