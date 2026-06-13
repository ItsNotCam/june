// author: Claude
import { listDocuments } from "@/lib/server/ingest-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return every latest document in the sidecar for the uploads table. */
export async function GET(): Promise<Response> {
  try {
    const documents = await listDocuments();
    return Response.json({ documents });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
