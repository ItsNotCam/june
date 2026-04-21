// author: Cam
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types";
import type { ZodRawShape } from "zod";


/**
 * Strongly-typed config parameter for McpServer.registerTool().
 * Pass a Zod raw shape as the type argument to type the inputSchema.
 */
export type ToolDefinition<TInput extends ZodRawShape = ZodRawShape> = {
	title?: string;
	description?: string;
	inputSchema?: TInput;
	outputSchema?: AnySchema | ZodRawShapeCompat;
	annotations?: ToolAnnotations;
	_meta?: Record<string, unknown>;
};

/**
 * Callback type for the function parameter of McpServer.registerTool().
 * Pass the same Zod raw shape used in ToolDefinition to type the parsed args.
 */
export type ToolFunction<TInput extends ZodRawShape = ZodRawShape> = ToolCallback<TInput>;

export type McpTool<TInput extends ZodRawShape = ZodRawShape> = {
	name: string;
	tool_definition: ToolDefinition<TInput>;
	function: ToolFunction<TInput>;
};
