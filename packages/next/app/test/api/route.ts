// author: Claude
/**
 * `/test/api` — control + telemetry for the single bench run.
 *
 *   POST  → start a run (202), or 409 if one is already in flight.
 *   GET   → Server-Sent Events: the current snapshot first (catch-up), then a
 *           message per progress delta until the run reaches a terminal state.
 *
 * Node runtime (the run manager spawns a child process) and force-dynamic (SSE
 * must never be cached or statically rendered).
 */
import { runManager, RunInProgressError } from "@/lib/test/run-manager";
import type { RunMessage } from "@/lib/test/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Heartbeat comment interval (ms) — keeps proxies from idling the SSE socket. */
const HEARTBEAT_MS = 15_000;

export async function POST(): Promise<Response> {
  try {
    const snapshot = await runManager.startRun();
    return Response.json({ status: snapshot.status, runId: snapshot.runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunInProgressError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to start run";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval>;
      let unsubscribe: () => void = () => {};
      const send = (data: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller already closed (client gone) — fall through to cleanup.
          closed = true;
        }
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed — nothing to do.
        }
      };

      const sendMessage = (msg: RunMessage): void => {
        send(`data: ${JSON.stringify(msg)}\n\n`);
        const status = msg.snapshot.status;
        if (status === "completed" || status === "error") cleanup();
      };

      // Catch-up: replay the latest snapshot so a late/reloaded client renders
      // current progress immediately.
      send(`data: ${JSON.stringify({ snapshot: runManager.getSnapshot() })}\n\n`);

      unsubscribe = runManager.subscribe(sendMessage);
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
