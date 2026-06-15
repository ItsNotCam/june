// author: Cam
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildDeps, loadConfig as loadIngestConfig } from "@june/mcp-ingest";
import type { PipelineDeps } from "@june/mcp-ingest";
import type { ZodRawShape } from "zod";
import { loadConfig } from "./config";
import { getEnv } from "./env";
import { createEmbedTool } from "./tools/embed";
import { createHelloTool } from "./tools/hello";
import { createIngestTool } from "./tools/ingest";
import { createSearchTool } from "./tools/search";
import { createHealthTool } from "./tools/health";
import type { McpTool } from "./types";

// app configuration
const env = getEnv();
const config = await loadConfig(env.CONFIG_PATH);

// Bootstrap the @june/mcp-ingest pipeline. The ingest package owns its own
// config/env singletons over the same process.env, so its loadConfig() MUST run
// before buildDeps() — the storage/embedder factories read getConfig()/getEnv()
// at construction. buildDeps() is NOT cheap wiring: createOllamaEmbedder makes a
// live Ollama dim-probe call, so this throws if Ollama/Qdrant are unreachable.
// Fail fast with a clear message rather than starting a half-dead server.
let deps: PipelineDeps;
try {
  await loadIngestConfig(env.INGEST_CONFIG_PATH);
  deps = await buildDeps();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(
    `Failed to initialize the june ingest pipeline (check OLLAMA_URL/QDRANT_URL and that both are reachable): ${message}`,
  );
}

const server = new McpServer(config.mcp_server);

// generic register function to register a new tool
const register = <T extends ZodRawShape>(tool: McpTool<T>) => {
	server.registerTool(tool.name, tool.tool_definition, tool.function);
}

// register the tools
register(createHelloTool());
register(createEmbedTool(config, env));
register(createSearchTool(deps));
register(createIngestTool(deps));
register(createHealthTool());

// startup the server
const transport = new StdioServerTransport();
await server.connect(transport);
