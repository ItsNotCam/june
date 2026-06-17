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
 * A registerable MCP tool: its name, typed definition, and the callback the
 * SDK invokes with parsed args. `function` is the SDK's `ToolCallback` over
 * the same raw shape used in `tool_definition.inputSchema`.
 */
export type McpTool<TInput extends ZodRawShape = ZodRawShape> = {
	name: string;
	tool_definition: ToolDefinition<TInput>;
	function: ToolCallback<TInput>;
};
