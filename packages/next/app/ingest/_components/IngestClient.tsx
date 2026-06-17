// author: Claude
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { BridgeEventSchema, INGEST_STAGES, type BridgeEvent, type DocumentRow } from "@/lib/ingest-events";
import { IngestTable, type IngestRow } from "./IngestTable";
import { UploadDropzone } from "./UploadDropzone";
import { WipeDialog } from "./WipeDialog";

/** A row is mid-pipeline when queued or running. */
const isActive = (r: IngestRow): boolean => r.status === "queued" || r.status === "running";

/** Top-level client island: owns the row state, the ingest stream, and wipes. */
export function IngestClient() {
  const [rows, setRows] = useState<IngestRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const [isIngesting, setIsIngesting] = useState(false);
  const [wipeTarget, setWipeTarget] = useState<IngestRow | undefined>(undefined);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const updateRow = useCallback(
    (id: string, patch: Partial<IngestRow> | ((r: IngestRow) => Partial<IngestRow>)): void => {
      setRows((rs) =>
        rs.map((r) => (r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)),
      );
    },
    [],
  );

  /** Reload DB documents, keeping live session rows (matched by docId) on top. */
  const loadDocuments = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) {
        const message = json && typeof json === "object" && "error" in json ? String(json.error) : `HTTP ${res.status}`;
        throw new Error(message);
      }
      const documents = (json as { documents: DocumentRow[] }).documents ?? [];
      setRows((prev) => {
        const sessionRows = prev.filter((r) => r.file);
        const sessionDocIds = new Set(sessionRows.map((r) => r.docId).filter(Boolean));
        const dbRows: IngestRow[] = documents
          .filter((d) => !sessionDocIds.has(d.docId))
          .map((d) => ({
            id: d.docId ?? d.sourceUri ?? d.name,
            name: d.name,
            status: "indexed",
            pct: 100,
            logs: [],
            docId: d.docId,
            sourceUri: d.sourceUri,
            byteLength: d.byteLength,
            hasStagedFile: d.hasStagedFile,
          }));
        return [...sessionRows, ...dbRows];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const addFiles = useCallback((files: File[]): void => {
    setRows((prev) => {
      const existing = new Set(prev.filter((r) => r.file).map((r) => r.name));
      const fresh: IngestRow[] = files
        .filter((f) => !existing.has(f.name))
        .map((f) => ({
          id: `local-${f.name}-${f.size}-${f.lastModified}`,
          name: f.name,
          status: "ready",
          pct: 0,
          logs: [],
          byteLength: f.size,
          file: f,
        }));
      return [...fresh, ...prev];
    });
  }, []);

  const removeRow = useCallback((row: IngestRow): void => {
    setRows((rs) => rs.filter((r) => r.id !== row.id));
  }, []);

  const handleEvent = useCallback(
    (event: BridgeEvent, ordered: ReadonlyArray<IngestRow>, map: Map<string, string>): void => {
      switch (event.type) {
        case "run_start":
          event.files.forEach((f, i) => {
            const local = ordered[i];
            if (!local) return;
            map.set(f.id, local.id);
            updateRow(local.id, { docId: f.docId, sourceUri: f.sourceUri, status: "queued" });
          });
          break;
        case "file_start": {
          const id = map.get(event.id);
          if (id) updateRow(id, (r) => ({ status: "running", pct: Math.max(r.pct, 5), logs: [...r.logs, "started"] }));
          break;
        }
        case "stage": {
          const id = map.get(event.id);
          if (!id) break;
          const idx = INGEST_STAGES.indexOf(event.stage);
          const pct = Math.round(((idx + 1) / INGEST_STAGES.length) * 100);
          const label = event.detail ? `${event.stage} (${event.detail})` : event.stage;
          updateRow(id, (r) => ({ status: "running", stage: event.stage, pct: Math.max(r.pct, pct), logs: [...r.logs, label] }));
          break;
        }
        case "file_done": {
          const id = map.get(event.id);
          if (id) updateRow(id, (r) => ({ status: "done", pct: 100, logs: [...r.logs, `done in ${Math.round(event.durationMs)}ms`] }));
          break;
        }
        case "file_skipped": {
          const id = map.get(event.id);
          if (id) updateRow(id, (r) => ({ status: "skipped", pct: 100, logs: [...r.logs, `skipped (${event.reason})`] }));
          break;
        }
        case "file_error": {
          const id = map.get(event.id);
          if (id) updateRow(id, (r) => ({ status: "error", logs: [...r.logs, `error: ${event.message}`] }));
          break;
        }
        case "fatal": {
          setError(event.message);
          // A fatal aborts the whole run before per-file events — don't leave
          // staged rows stuck at "queued".
          const activeIds = new Set(ordered.map((o) => o.id));
          setRows((rs) =>
            rs.map((r) =>
              activeIds.has(r.id) && (r.status === "queued" || r.status === "running")
                ? { ...r, status: "error", logs: [...r.logs, `error: ${event.message}`] }
                : r,
            ),
          );
          break;
        }
        case "run_done":
        case "documents":
        case "purged":
          break;
      }
    },
    [updateRow],
  );

  const ingestAll = useCallback(async (): Promise<void> => {
    const ordered = rows.filter((r) => r.file && (r.status === "ready" || r.status === "error"));
    if (ordered.length === 0) return;

    setIsIngesting(true);
    setError(undefined);
    setRows((rs) =>
      rs.map((r) => (ordered.some((o) => o.id === r.id) ? { ...r, status: "queued", pct: 0, logs: [], stage: undefined } : r)),
    );

    const form = new FormData();
    for (const r of ordered) if (r.file) form.append("files", r.file, r.name);

    const serverToLocal = new Map<string, string>();
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      if (!res.ok || !res.body) throw new Error(`Ingest request failed (HTTP ${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          const event = BridgeEventSchema.safeParse(parsed);
          if (event.success) handleEvent(event.data, ordered, serverToLocal);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
      void loadDocuments();
    }
  }, [rows, handleEvent, loadDocuments]);

  const doWipe = useCallback(async (): Promise<void> => {
    if (!wipeTarget?.docId) return;
    const { id, docId } = wipeTarget;
    setWipeBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/documents/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId }),
      });
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => undefined);
        const message = json && typeof json === "object" && "error" in json ? String(json.error) : `HTTP ${res.status}`;
        throw new Error(message);
      }
      setRows((rs) => rs.filter((r) => r.id !== id && r.docId !== docId));
      setWipeTarget(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWipeBusy(false);
    }
  }, [wipeTarget]);

  const readyCount = rows.filter((r) => r.file && (r.status === "ready" || r.status === "error")).length;
  const activeCount = rows.filter(isActive).length;
  const inFlight = isIngesting || activeCount > 0;

  return (
    <div className="space-y-6">
      <UploadDropzone onFiles={addFiles} disabled={inFlight} />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {readyCount > 0 ? `${readyCount} file${readyCount === 1 ? "" : "s"} ready to ingest` : "Upload markdown to ingest"}
        </p>
        <Button onClick={() => void ingestAll()} disabled={inFlight || readyCount === 0}>
          {inFlight ? "Ingesting…" : `Ingest all${readyCount > 0 ? ` (${readyCount})` : ""}`}
        </Button>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
          <span className="font-mono text-xs break-all">{error}</span>
          <button className="shrink-0 text-xs underline" onClick={() => setError(undefined)}>
            dismiss
          </button>
        </div>
      )}

      <IngestTable
        rows={rows}
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((cur) => (cur === id ? undefined : id))}
        onWipe={(row) => setWipeTarget(row)}
        onRemove={removeRow}
      />

      <WipeDialog
        open={wipeTarget !== undefined}
        name={wipeTarget?.name ?? ""}
        busy={wipeBusy}
        onCancel={() => !wipeBusy && setWipeTarget(undefined)}
        onConfirm={() => void doWipe()}
      />
    </div>
  );
}
