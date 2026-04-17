import z from "zod";

/** Validates MCP server identity fields. Version must follow semver with an optional single-letter suffix (e.g. `0.1.0a`). */
export const McpServerSchema = z.object({
	name: z.string().min(1),
	version: z.string().regex(/^\d+(?:\.\d+){2}[a-zA-Z]?$/), // 0.1.0a
})

/** Full config schema for the MCP package — non-secret tunables loaded from the YAML config file at startup. */
export const ConfigSchema = z.object({
	mcp_server: McpServerSchema.readonly(),
	ollama_embedding_model: z
		.string()
		.min(1)
		.readonly()
}).readonly();

/** Inferred from ConfigSchema — never define manually. */
export type Config = z.infer<typeof ConfigSchema>;