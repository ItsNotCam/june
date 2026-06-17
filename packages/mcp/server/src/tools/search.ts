// author: Claude
import { query as runQuery } from "@june/mcp-ingest";
import type { PipelineDeps } from "@june/mcp-ingest";
import z from "zod";
import type { McpTool } from "../types";

const inputSchema = {
  query: z.string().min(1).describe("Natural-language search query"),
  k: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Max number of chunks to return (defaults to the server's configured k)"),
};

/**
 * The core RAG tool. Runs june's hybrid retriever (dense + BM25 → RRF) over the
 * ingested corpus and returns the top-k chunks **raw** — content plus citation
 * metadata and fusion score. The calling model is the reader; the server does
 * not synthesize an answer.
 *
 * @param deps - Shared pipeline deps from `buildDeps()`; supplies the embedder
 *   and vector store the retriever reuses.
 */
export const createSearchTool = (deps: PipelineDeps): McpTool<typeof inputSchema> => ({
  name: "search",
  tool_definition: {
    title: "Search the june knowledge base",
    description:
      "Hybrid semantic + keyword retrieval over ingested documents. Returns the most relevant chunks (raw content, citation metadata, and relevance score) for you to read and answer from. Does not generate an answer itself.",
    inputSchema,
  },
  function: async ({ query, k }) => {
    const results = await runQuery(
      { embedder: deps.embedder, vector: deps.storage.vector },
      { text: query, k },
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  },
});
