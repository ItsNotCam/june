// author: Claude
/**
 * Dashboard HTTP server — zero-dependency `Bun.serve`.
 *
 * Serves the static vanilla frontend (`public/`) and a tiny JSON + SSE API over
 * the read-only `reader.ts` data layer. No framework, no build step: the bench
 * stays dependency-light and the dashboard is `june-eval dashboard` away.
 *
 * Endpoints:
 *   GET /                      → public/index.html
 *   GET /static/<file>         → public/<file>            (path-traversal guarded)
 *   GET /api/runs              → RunSummary[]             (newest first)
 *   GET /api/runs/:id          → { kind, results, summary_md }
 *   GET /api/golden            → Record<fixture_hash, GoldenNormalized>
 *   GET /api/stream            → text/event-stream: active-run progress + runs_changed
 */
import { join, normalize } from "path";
import {
  listRunIds,
  listRunSummaries,
  getRunDetail,
  loadGolden,
  detectActiveRun,
  readProgressEvents,
  inferStageFromArtifacts,
  RUN_ID_RE,
} from "./reader";
import { fileExists } from "@/lib/artifacts";

export type DashboardServerOptions = {
  /** Port to bind. 0 = OS-assigned ephemeral (used by tests). */
  port: number;
  hostname?: string;
  /** Absolute path to `state/runs`. */
  runsRoot: string;
  /** Absolute path to `golden.json`. */
  goldenPath: string;
  /** Absolute path to the static `public/` dir (defaults to the one beside this module). */
  publicDir?: string;
  /** SSE poll interval (ms). */
  pollMs?: number;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const contentTypeFor = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot)]) || "application/octet-stream";
};

/** Serve a file from `publicDir`, refusing any path that escapes it. */
const serveStatic = async (publicDir: string, relRaw: string): Promise<Response> => {
  // Strip the leading slash, normalize, and confirm the result stays inside publicDir.
  const rel = normalize(relRaw.replace(/^\/+/, ""));
  if (rel.startsWith("..") || rel.includes("\0")) return new Response("Not found", { status: 404 });
  const full = join(publicDir, rel);
  if (!full.startsWith(publicDir)) return new Response("Not found", { status: 404 });
  const file = Bun.file(full);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentTypeFor(full) } });
};

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * One SSE connection's poll loop: detects new/completed runs (`runs_changed`)
 * and relays the active run's progress — tailing `progress.ndjson` when present,
 * else inferring the current stage from which artifacts exist.
 */
const makeStream = (opts: Required<Pick<DashboardServerOptions, "runsRoot" | "pollMs">>): Response => {
  const { runsRoot, pollMs } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastRunsKey = "";
  let activeId: string | null = null;
  let sentEventCount = 0;
  let lastStage = 0;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(enc.encode(sse(event, data)));
        } catch {
          /* connection closed mid-enqueue */
        }
      };

      const tick = async (): Promise<void> => {
        const ids = await listRunIds(runsRoot);
        const newest = ids[0] ?? "";
        const newestDone =
          newest !== "" &&
          ((await fileExists(join(runsRoot, newest, "results.json"))) ||
            (await fileExists(join(runsRoot, newest, "holdout_results.json"))));
        // Key changes when a run is added OR the newest run flips to completed.
        const key = `${ids.length}:${newest}:${newestDone ? 1 : 0}`;
        if (key !== lastRunsKey) {
          lastRunsKey = key;
          send("runs_changed", { count: ids.length });
        }

        const active = await detectActiveRun(runsRoot);
        if (!active) {
          if (activeId !== null) {
            activeId = null;
            send("idle", {});
          }
          return;
        }
        if (active.run_id !== activeId) {
          activeId = active.run_id;
          sentEventCount = 0;
          lastStage = 0;
          send("active", {
            run_id: active.run_id,
            kind: active.kind,
            observability: active.observability,
          });
        }
        if (active.observability === "events") {
          const events = (await readProgressEvents(active.run_dir)) ?? [];
          for (; sentEventCount < events.length; sentEventCount++) {
            send("progress", events[sentEventCount]);
          }
        } else {
          const stage = await inferStageFromArtifacts(active.run_dir);
          if (stage > lastStage) {
            lastStage = stage;
            send("progress", { type: "stage_inferred", stage, source: "artifacts" });
          }
        }
      };

      send("hello", { ok: true });
      // Fire once immediately, then on the poll interval. Errors are swallowed
      // so one bad tick never tears down the stream.
      void tick().catch(() => {});
      timer = setInterval(() => void tick().catch(() => {}), pollMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
};

/**
 * Build the request handler. Exposed separately from `startDashboardServer` so
 * tests can exercise routing without binding a port (via `Bun.serve({ port: 0 })`).
 */
export const createHandler = (opts: DashboardServerOptions) => {
  const publicDir = opts.publicDir ?? join(import.meta.dir, "public");
  const pollMs = opts.pollMs ?? 1500;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") return serveStatic(publicDir, "index.html");
    if (path.startsWith("/static/")) return serveStatic(publicDir, path.slice("/static".length));

    if (path === "/api/runs") return json(await listRunSummaries(opts.runsRoot));

    const detailMatch = path.match(/^\/api\/runs\/([^/]+)$/);
    if (detailMatch) {
      const runId = decodeURIComponent(detailMatch[1]!);
      if (!RUN_ID_RE.test(runId)) return json({ error: "invalid run id" }, 400);
      const detail = await getRunDetail(opts.runsRoot, runId);
      return detail ? json(detail) : json({ error: "not found" }, 404);
    }

    if (path === "/api/golden") return json(await loadGolden(opts.goldenPath));

    if (path === "/api/stream") return makeStream({ runsRoot: opts.runsRoot, pollMs });

    return new Response("Not found", { status: 404 });
  };
};

/** Start the dashboard server. Returns the Bun server handle (has `.port`, `.stop()`). */
export const startDashboardServer = (opts: DashboardServerOptions) => {
  const handler = createHandler(opts);
  return Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    idleTimeout: 0, // SSE connections are long-lived
    fetch: handler,
  });
};
