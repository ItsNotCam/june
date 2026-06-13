// author: Claude
import { purgeDocument } from "@/lib/server/ingest-runner";
import { PurgeRequestSchema } from "@/lib/ingest-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard-delete a document's embeddings + sidecar rows + staged file. */
export async function POST(request: Request): Promise<Response> {
  const body = PurgeRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    return Response.json({ error: "Expected { docId: string }" }, { status: 400 });
  }

  try {
    const result = await purgeDocument(body.data.docId);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
