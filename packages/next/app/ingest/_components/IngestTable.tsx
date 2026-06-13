// author: Claude
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import type { IngestStage } from "@/lib/ingest-events";

export type RowStatus = "ready" | "queued" | "running" | "done" | "skipped" | "error" | "indexed";

/** A single uploads-table row — either a session upload or an existing DB doc. */
export type IngestRow = {
  id: string;
  name: string;
  status: RowStatus;
  pct: number;
  stage?: IngestStage;
  logs: string[];
  docId?: string;
  sourceUri?: string;
  byteLength?: number;
  hasStagedFile?: boolean;
  /** Present only for not-yet-ingested session uploads. */
  file?: File;
};

type IngestTableProps = {
  rows: ReadonlyArray<IngestRow>;
  expandedId: string | undefined;
  onToggle: (id: string) => void;
  onWipe: (row: IngestRow) => void;
  onRemove: (row: IngestRow) => void;
};

const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case "running":
      return <Badge>running</Badge>;
    case "done":
      return <Badge className="bg-success/15 text-success">done</Badge>;
    case "indexed":
      return <Badge className="bg-success/15 text-success">indexed</Badge>;
    case "error":
      return <Badge variant="destructive">error</Badge>;
    case "skipped":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          skipped
        </Badge>
      );
    case "queued":
      return <Badge variant="secondary">queued</Badge>;
    default:
      return <Badge variant="secondary">ready</Badge>;
  }
}

const BAR_COLOR: Record<RowStatus, string> = {
  ready: "bg-muted-foreground/40",
  queued: "bg-muted-foreground/40",
  running: "bg-primary",
  done: "bg-success",
  indexed: "bg-success",
  skipped: "bg-warning",
  error: "bg-destructive",
};

/** The uploads table: one row per file, click a row to reveal its live log. */
export function IngestTable({ rows, expandedId, onToggle, onWipe, onRemove }: IngestTableProps) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
        No documents yet. Upload markdown above to get started.
      </div>
    );
  }

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 border-b">
            <th className="text-muted-foreground w-8 px-4 py-3" />
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">Name</th>
            <th className="text-muted-foreground px-4 py-3 text-right font-medium">Size</th>
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">Status</th>
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">Progress</th>
            <th className="text-muted-foreground px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = row.id === expandedId;
            return (
              <FragmentRows
                key={row.id}
                row={row}
                expanded={expanded}
                onToggle={onToggle}
                onWipe={onWipe}
                onRemove={onRemove}
                formatBytes={formatBytes}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({
  row,
  expanded,
  onToggle,
  onWipe,
  onRemove,
  formatBytes: fmt,
}: {
  row: IngestRow;
  expanded: boolean;
  onToggle: (id: string) => void;
  onWipe: (row: IngestRow) => void;
  onRemove: (row: IngestRow) => void;
  formatBytes: (bytes: number | undefined) => string;
}) {
  const size = row.byteLength ?? row.file?.size;
  return (
    <>
      <tr
        className="hover:bg-muted/20 cursor-pointer border-b last:border-0"
        onClick={() => onToggle(row.id)}
      >
        <td className="text-muted-foreground px-4 py-3 text-center">
          <span className="inline-block transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>
            ›
          </span>
        </td>
        <td className="max-w-64 truncate px-4 py-3 font-medium" title={row.name}>
          {row.name}
        </td>
        <td className="text-muted-foreground px-4 py-3 text-right font-mono text-xs">
          {fmt(size)}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={row.status} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="bg-muted h-2 w-32 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full transition-all", BAR_COLOR[row.status])}
                style={{ width: `${row.pct}%` }}
              />
            </div>
            <span className="text-muted-foreground w-9 font-mono text-xs">{row.pct}%</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {row.docId ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onWipe(row)}>
              Wipe
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onRemove(row)}>
              Remove
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10 border-b last:border-0">
          <td colSpan={6} className="px-4 py-3">
            {row.logs.length > 0 ? (
              <pre className="bg-muted max-h-56 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed">
                {row.logs.join("\n")}
              </pre>
            ) : (
              <p className="text-muted-foreground text-xs">
                {row.docId
                  ? "No live log — this document was ingested in an earlier session."
                  : "Not ingested yet. Click “Ingest all” to start the pipeline."}
              </p>
            )}
            {row.sourceUri && (
              <p className="text-muted-foreground mt-2 font-mono text-[11px] break-all">{row.sourceUri}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
