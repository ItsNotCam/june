// author: Claude
import { ingestContent } from "@june/mcp-ingest";
import type { PipelineDeps } from "@june/mcp-ingest";
import z from "zod";
import type { McpTool } from "../types";

const inputSchema = {
  content: z.string().min(1).describe("Markdown document content to ingest"),
  sourceUri: z
    .string()
    .min(1)
    .describe(
      "Stable virtual URI for the document (e.g. mcp://session/<id>/<name>.md). Participates in dedup — same URI + same content is recognized as unchanged. Not a filesystem path; never opened.",
    ),
};

/**
 * Ingests a markdown document into june's pipeline via `ingestContent` — the
 * network-safe entry point (no filesystem access; `sourceUri` is virtual).
 *
 * `ingestContent` acquires the sidecar's single-writer lock and throws
 * `SidecarLockHeldError` on any concurrent call, so this tool serializes
 * invocations behind an in-process promise chain — an MCP server can receive
 * overlapping tool calls.
 *
 * @param deps - Shared pipeline deps from `buildDeps()`.
 */
export const createIngestTool = (deps: PipelineDeps): McpTool<typeof inputSchema> => {
  // Serializes ingest calls so they never contend for the single-writer lock.
  let chain: Promise<unknown> = Promise.resolve();

  return {
    name: "ingest",
    tool_definition: {
      title: "Ingest a document into june",
      description:
        "Chunk, embed, and store a markdown document so it becomes searchable. Returns a run summary (processed/skipped/errored). Calls are serialized server-side to respect the single-writer lock.",
      inputSchema,
    },
    function: async ({ content, sourceUri }) => {
      const run = chain.then(() => ingestContent({ content, sourceUri, deps }));
      // Keep the chain alive even if this call rejects, so a failure doesn't
      // wedge every subsequent ingest behind a rejected promise.
      chain = run.catch(() => undefined);
      const result = await run;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                run_id: result.run.run_id,
                processed: result.processed,
                skipped: result.skipped,
                errored: result.errored,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
};
