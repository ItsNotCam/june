import z from "zod";

export const McpServerSchema = z.object({
	name: z.string().min(1),
	version: z.string().regex(/^\d+(?:\.\d+){2}[a-zA-Z]?$/), // 0.1.0a
})

export const ConfigSchema = z.object({
	mcp_server: McpServerSchema.readonly(),

	ollama_embedding_model: z
		.string()
		.min(1)
		.readonly()
	
}).readonly();

export type Config = z.infer<typeof ConfigSchema>;