// author: Cam
import { config } from "winston";

/** All valid NODE_ENV values. Zod enum sources from this array. */
export const NODE_ENV_VALUES = ["development", "production", "test"] as const;
export type NodeEnv = (typeof NODE_ENV_VALUES)[number];

/** Derived directly from Winston's npm levels — single source of truth. */
export type LogLevel = Extract<keyof typeof config.npm.levels, string>;

/** Runtime array of Winston npm level names for Zod enum construction. */
export const LOG_LEVEL_VALUES = Object.keys(config.npm.levels) as [LogLevel, ...LogLevel[]];
