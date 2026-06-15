// author: Claude
import { health } from "@june/mcp-ingest";
import type { McpTool } from "../types";

const inputSchema = {};

/**
 * Reports reachability of the pipeline's backends (SQLite sidecar, Qdrant,
 * Ollama). Wraps `@june/mcp-ingest`'s `health()`, which probes them directly —
 * no deps needed. Useful as an MCP-level liveness check before search/ingest.
 */
export const createHealthTool = (): McpTool<typeof inputSchema> => ({
  name: "health",
  tool_definition: {
    title: "Check june backend health",
    description:
      "Probe reachability of the SQLite sidecar, Qdrant, and Ollama. Returns per-backend booleans and an overall ok flag.",
    inputSchema,
  },
  function: async () => {
    const report = await health();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
    };
  },
});
