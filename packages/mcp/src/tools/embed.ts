import type { Config } from "@/config";
import type { Env } from "@/env";
import { embed } from "@june/shared";
import z from "zod";

export type EmbedToolProps = { 
	input: string,
	config: Config,
	env: Env 
}

export const EmbedTool = {
	name: "embed",
	tool_definition: { 
		description: "Embed a message",
		inputSchema: { input: z.string().describe("Input to embed") }
	},
	function: async ({ input, config, env }: EmbedToolProps) => {
		const embedding = await embed(
			config.ollama_embedding_model, 
			input, 
			env.OLLAMA_URL
		);
		
		return {
			content: [{ type: "text" as const, text: JSON.stringify(embedding) }]
		}
	}
}