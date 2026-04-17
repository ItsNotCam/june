import { createConfig } from "@june/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import { ConfigSchema } from "./config";
import { getEnv } from "./env";
import { createEmbedTool } from "./tools/embed";
import { createHelloTool } from "./tools/hello";
import type { McpTool } from "./types";

// app configuration
const env = getEnv();
const cfg = createConfig(ConfigSchema);
const config = await cfg.loadConfig(env.CONFIG_PATH);
const server = new McpServer(config.mcp_server);

// generic register function to register a new tool
const register = <T extends ZodRawShape>(tool: McpTool<T>) => {
	server.registerTool(tool.name, tool.tool_definition, tool.function);
}

// register the tools
register(createHelloTool());
register(createEmbedTool(config, env));

// startup the server
const transport = new StdioServerTransport();
await server.connect(transport);
