import { createConfig } from "@june/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigSchema } from "./config";
import { getEnv } from "./env";
import { EmbedTool } from "./tools/embed";

// app configuration
const env = getEnv();
const cfg = createConfig(ConfigSchema);
const config = await cfg.loadConfig(env.CONFIG_PATH);
const server = new McpServer(config.mcp_server);

server.registerTool(
  "hello",
  {
    description: "A simple hello world tool",
    inputSchema: { name: z.string().describe("Name to greet") },
  },
  async ({ name }) => ({
    content: [{ type: "text" as const, text: `Hello, ${name}!` }],
  })
);

server.registerTool(
	EmbedTool.name, 
	EmbedTool.tool_definition, 
	async ({ input }) => EmbedTool.function({ input, config, env })
);

const transport = new StdioServerTransport();
await server.connect(transport);
