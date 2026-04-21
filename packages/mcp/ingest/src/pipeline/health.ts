// author: Claude
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createQdrantStorage } from "@/lib/storage/qdrant";
import { openSidecar } from "@/lib/storage/sqlite/migrate";

/**
 * Reachability probe for `june health` ([§27](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#27-cli)). Checks:
 *   1. SQLite is openable at the configured path.
 *   2. Qdrant responds to a list-collections call.
 *   3. Ollama responds to `/api/tags`.
 *
 * Returns a plain record; the CLI translates to an exit code.
 */
export type HealthReport = {
  ok: boolean;
  sqlite: boolean;
  qdrant: boolean;
  ollama: boolean;
  errors: ReadonlyArray<string>;
};

export const health = async (): Promise<HealthReport> => {
  const errors: string[] = [];
  const env = getEnv();
  const cfg = getConfig();

  let sqlite = false;
  try {
    const db = await openSidecar(cfg.sidecar.path);
    db.close();
    sqlite = true;
  } catch (err) {
    errors.push(`sqlite: ${err instanceof Error ? err.message : String(err)}`);
  }

  let qdrant = false;
  try {
    qdrant = await createQdrantStorage().probeReachable();
    if (!qdrant) errors.push("qdrant: probe failed");
  } catch (err) {
    errors.push(`qdrant: ${err instanceof Error ? err.message : String(err)}`);
  }

  let ollama = false;
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/tags`);
    ollama = res.ok;
    if (!ollama) errors.push(`ollama: HTTP ${res.status}`);
  } catch (err) {
    errors.push(`ollama: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ok = sqlite && qdrant && ollama;
  logger.info("health_probe", {
    event: "health_probe",
    status: ok ? "ok" : "degraded",
  });
  return { ok, sqlite, qdrant, ollama, errors };
};
