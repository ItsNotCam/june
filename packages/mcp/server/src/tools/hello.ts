// author: Cam
import z from "zod";
import type { McpTool } from "@/types";

const inputSchema = { name: z.string().describe("Your name") };

/**
 * Creates a simple greeting tool — primarily a smoke test for MCP tool registration.
 * Takes a name and returns a greeting string.
 */
export const createHelloTool = (): McpTool<typeof inputSchema> => ({
	name: "hello-world",
	tool_definition: { 
		description: "A simple hello world tool",
		inputSchema,
	},
	function: async ({ name }) => ({
		content: [{ type: "text" as const, text: `Hello, ${name}!` }],
	})
});
