// author: Claude
/**
 * Test preamble — sets the env vars `lib/env.ts` requires before any
 * module imports it. Registered as a preload in `bunfig.toml`.
 */
process.env["ANTHROPIC_API_KEY"] ??= "sk-ant-test-key";
process.env["OLLAMA_URL"] ??= "http://localhost:11434";
process.env["QDRANT_URL"] ??= "http://localhost:6334";
process.env["JUNE_BIN"] ??= "june";
process.env["CONFIG_PATH"] ??= "./config.yaml";
process.env["LOG_LEVEL"] ??= "error";
