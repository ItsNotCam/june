"use client";
// author: Claude
/**
 * Editable run configuration. Loads the saved config from `/test/api/config`,
 * lets the operator tweak ingest tunables + run options, and PUTs them back.
 * Locked (inputs disabled) while a run is live — the server also rejects PUT
 * with 409 during a run, so this is just UX.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TestRunConfig } from "@/lib/test/config";

type Mutate = (c: TestRunConfig) => void;

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ConfigPanel({ disabled = false }: { disabled?: boolean }) {
  const [config, setConfig] = useState<TestRunConfig | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/test/api/config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { config: TestRunConfig };
        setConfig(body.config);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load config");
      }
    })();
  }, []);

  const update = useCallback((mut: Mutate) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await fetch("/test/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = (await res.json().catch(() => ({}))) as { config?: TestRunConfig; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.config) setConfig(body.config);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [config]);

  const locked = disabled || saving;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Configuration</span>
          <span className="flex items-center gap-2 text-xs font-normal">
            {dirty ? <span className="text-warning">unsaved</span> : null}
            {saved && !dirty ? <span className="text-success">saved</span> : null}
            <Button size="sm" onClick={save} disabled={locked || !dirty || !config}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {!config ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <>
            {/* Run options */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Run</h3>
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  label="Sample ratio (1 = full, 0.1 = quick)"
                  value={config.run.sample_ratio}
                  step={0.05}
                  min={0.01}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.run.sample_ratio = n))}
                />
                <NumberField
                  label="Reader concurrency"
                  value={config.run.reader_concurrency}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.run.reader_concurrency = n))}
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={config.run.cache}
                    disabled={locked}
                    onCheckedChange={(v) => update((c) => (c.run.cache = v))}
                  />
                  <Label className="text-sm">Response cache</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={config.run.baseline}
                    disabled={locked}
                    onCheckedChange={(v) => update((c) => (c.run.baseline = v))}
                  />
                  <Label className="text-sm">No-RAG baseline</Label>
                </div>
              </div>
            </section>

            {/* Ingest tunables */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Ingest</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <NumberField
                  label="Chunk target tokens"
                  value={config.ingest.chunk.target_tokens}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.chunk.target_tokens = n))}
                />
                <NumberField
                  label="Chunk min tokens"
                  value={config.ingest.chunk.min_tokens}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.chunk.min_tokens = n))}
                />
                <NumberField
                  label="Chunk max tokens"
                  value={config.ingest.chunk.max_tokens}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.chunk.max_tokens = n))}
                />
                <NumberField
                  label="Overlap (0–0.5)"
                  value={config.ingest.chunk.overlap_pct}
                  step={0.01}
                  min={0}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.chunk.overlap_pct = n))}
                />
                <NumberField
                  label="Embedding batch size"
                  value={config.ingest.embedding.batch_size}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.embedding.batch_size = n))}
                />
                <NumberField
                  label="Embedding max input chars"
                  value={config.ingest.embedding.max_input_chars}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.embedding.max_input_chars = n))}
                />
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground text-xs">Matryoshka dim (blank = off)</Label>
                  <Input
                    type="number"
                    min={1}
                    disabled={locked}
                    value={config.ingest.embedding.matryoshka_dim ?? ""}
                    onChange={(e) =>
                      update(
                        (c) =>
                          (c.ingest.embedding.matryoshka_dim =
                            e.target.value === "" ? null : Number(e.target.value)),
                      )
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground text-xs">Summarizer</Label>
                  <select
                    className="border-input bg-background h-8 rounded-lg border px-2 text-sm disabled:opacity-50"
                    value={config.ingest.summarizer.implementation}
                    disabled={locked}
                    onChange={(e) =>
                      update(
                        (c) =>
                          (c.ingest.summarizer.implementation = e.target
                            .value as TestRunConfig["ingest"]["summarizer"]["implementation"]),
                      )
                    }
                  >
                    <option value="ollama">ollama</option>
                    <option value="stub">stub</option>
                    <option value="mock">mock</option>
                  </select>
                </div>
                <NumberField
                  label="Long-doc threshold tokens"
                  value={config.ingest.summarizer.long_doc_threshold_tokens}
                  min={1}
                  disabled={locked}
                  onChange={(n) => update((c) => (c.ingest.summarizer.long_doc_threshold_tokens = n))}
                />
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
