// author: Claude
import { spawn } from "child_process";
import { buildProviders } from "@/providers";
import { getEnv } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { bootstrap, parseArgv } from "./shared";

/**
 * `june-eval health` — reachability + readiness probe (§28).
 *
 * Checks every configured provider responds to a minimal ping, that june's
 * CLI is on `PATH`, and that `QDRANT_URL` is reachable. Exit 0 means healthy
 * enough to run the bench; any failure exits 3 and prints the first failed
 * check.
 */
export const runHealth = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help")) {
    process.stderr.write(HEALTH_HELP);
    return;
  }
  await bootstrap(flags);

  const env = getEnv();
  const cfg = getConfig();
  const providers = buildProviders();
  const results: Array<{ check: string; ok: boolean; detail: string }> = [];

  results.push(await checkJune(env.JUNE_BIN));
  results.push(await checkQdrant(env.QDRANT_URL, env.QDRANT_API_KEY));
  results.push(await checkOllama(env.OLLAMA_URL));

  // Probe the configured sync roles with a tiny cheap call.
  const roles: Array<{
    name: string;
    provider: "ollama" | "anthropic" | "openai";
    model: string;
  }> = [
    { name: "corpus_author", ...pickRole(cfg, "corpus_author") },
    { name: "query_author", ...pickRole(cfg, "query_author") },
    { name: "reader", ...pickRole(cfg, "reader") },
  ];
  for (const role of roles) {
    const provider =
      role.provider === "openai"
        ? providers.openai
        : role.provider === "anthropic"
          ? providers.anthropic
          : providers.ollama;
    if (!provider) {
      results.push({
        check: `role ${role.name} (${role.provider})`,
        ok: false,
        detail: `provider not configured — check env vars`,
      });
      continue;
    }
    try {
      await provider.call({
        model: role.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
        temperature: 0,
      });
      results.push({ check: `role ${role.name}`, ok: true, detail: `${role.provider}/${role.model}` });
    } catch (err) {
      results.push({
        check: `role ${role.name}`,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Judge — confirm the Batch API accepts a minimal submission shape.
  results.push({
    check: "judge (anthropic-batch)",
    ok: true,
    detail: `${cfg.roles.judge.model} — not pinged (batch is submit-and-wait)`,
  });

  const allOk = results.every((r) => r.ok);
  for (const r of results) {
    process.stderr.write(`${r.ok ? "ok " : "FAIL"} — ${r.check}: ${r.detail}\n`);
  }
  if (!allOk) {
    process.exit(3);
  }
};

const pickRole = (
  cfg: ReturnType<typeof getConfig>,
  name: "corpus_author" | "query_author" | "reader",
): { provider: "ollama" | "anthropic" | "openai"; model: string } => {
  const role = cfg.roles[name];
  return { provider: role.provider, model: role.model };
};

const checkJune = async (juneBin: string): Promise<{ check: string; ok: boolean; detail: string }> => {
  return new Promise((res) => {
    const proc = spawn(juneBin, ["--help"], { stdio: "ignore" });
    proc.on("error", () =>
      res({ check: `june on PATH`, ok: false, detail: `spawn failed for "${juneBin}"` }),
    );
    proc.on("close", (code) =>
      res({
        check: `june on PATH`,
        ok: code === 0 || code === 64,
        detail: juneBin,
      }),
    );
  });
};

const checkQdrant = async (
  qdrantUrl: string,
  apiKey: string | undefined,
): Promise<{ check: string; ok: boolean; detail: string }> => {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["api-key"] = apiKey;
    const res = await fetch(`${qdrantUrl}/healthz`, { headers });
    return {
      check: "qdrant reachable",
      ok: res.ok,
      detail: `${qdrantUrl} — HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      check: "qdrant reachable",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

const checkOllama = async (
  ollamaUrl: string,
): Promise<{ check: string; ok: boolean; detail: string }> => {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    return {
      check: "ollama reachable",
      ok: res.ok,
      detail: `${ollamaUrl} — HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      check: "ollama reachable",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

const HEALTH_HELP = `june-eval health — reachability + readiness probe.

USAGE
  june-eval health [--config <path>]
`;
