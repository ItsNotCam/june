import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types";
import type z from "zod";

export type ToolDefinition = {
    title?: string;
    description?: string;
    inputSchema?: {
        input: z.ZodString;
    } | undefined;
    outputSchema?: AnySchema | ZodRawShapeCompat | undefined;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
}