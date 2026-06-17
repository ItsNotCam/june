// author: Claude
/**
 * `GET /test/api/ollama-models` — chat-capable models available on the
 * configured Ollama server, for the `/test` model pickers.
 *
 * Reads `OLLAMA_URL` (via getTestConfig), queries `/api/tags`, and returns the
 * sorted model names with embedding models filtered out (they can't serve the
 * summarizer/reader roles). 500 with `{ error }` when the server is
 * unreachable or `OLLAMA_URL` is unset — the UI surfaces the message.
 */
import { z } from "zod";
import { getTestConfig } from "@/lib/test/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TagsSchema = z.object({
  models: z.array(z.object({ name: z.string() })),
});

export async function GET(): Promise<Response> {
  const { ollamaUrl } = getTestConfig();
  if (!ollamaUrl) {
    return Response.json(
      { error: "OLLAMA_URL is not set — cannot auto-detect Ollama models" },
      { status: 500 },
    );
  }
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);
    const parsed = TagsSchema.parse(await res.json());
    const models = parsed.models
      .map((m) => m.name)
      .filter((n) => !/embed/i.test(n))
      .sort((a, b) => a.localeCompare(b));
    return Response.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list Ollama models";
    return Response.json({ error: message }, { status: 500 });
  }
}
