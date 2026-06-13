// author: Claude
import { runIngest, type Upload } from "@/lib/server/ingest-runner";
import type { BridgeEvent } from "@/lib/ingest-events";

/** Pipeline work spawns a Bun child + touches SQLite — must run on Node, never edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage uploaded markdown and run the full ingestion pipeline, streaming
 * per-file progress back as newline-delimited `BridgeEvent` JSON so the client
 * can drive live progress bars + logs.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  const uploads: Upload[] = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BridgeEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        if (uploads.length === 0) {
          send({ type: "fatal", message: "No markdown files were uploaded." });
          return;
        }
        await runIngest(uploads, send);
      } catch (err) {
        send({ type: "fatal", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
