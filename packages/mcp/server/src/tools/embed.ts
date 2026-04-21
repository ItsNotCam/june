// author: Cam
import type { Config } from "@/config";
import type { Env } from "@/env";
import { embed } from "@/lib/ollama";
import z from "zod";
import type { McpTool } from "@/types";

const inputSchema = { input: z.string().describe("Input to embed") };

/**
 * Creates the embed tool with config and env captured in the closure.
 * Calls the Ollama embedding model specified in config and returns the raw EmbedResponse as JSON.
 *
 * @param config - Loaded app config; provides the Ollama embedding model name.
 * @param env - Validated env; provides OLLAMA_URL.
 */
export const createEmbedTool = (config: Config, env: Env): McpTool<typeof inputSchema> => ({
	name: "embed",
	tool_definition: {
		description: "Embed a message",
		inputSchema,
	},
	function: async ({ input }) => {
		const embedding = await embed(config.ollama_embedding_model, input, env.OLLAMA_URL);
		return {
			content: [{ type: "text" as const, text: JSON.stringify(embedding) }],
		};
	},
});