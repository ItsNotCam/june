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
import { PROVIDERS, curatedModelsFor, type ProviderValue } from "@/lib/test/model-catalog";

type Mutate = (c: TestRunConfig) => void;

/** Minimal slice of `/test/api/runs` we need to offer prior ingests for reuse. */
type ReusableRun = {
  runId: string;
  status: string;
  stagesComplete: number;
  startedAt?: string;
  metrics?: { recallAt5?: number };
};

const SELECT_CLASS =
  "border-input bg-background h-8 rounded-lg border px-2 text-sm disabled:opacity-50";

/**
 * Provider + model picker for one role. Ollama models come from the live
 * auto-detected list; Claude/DeepSeek are curated. The current `model` is always
 * kept selectable even if it isn't in the active list (e.g. before the ollama
 * list loads). Switching provider defaults the model to that provider's first.
 */
function RoleModelPicker({
  label,
  provider,
  model,
  ollamaModels,
  disabled,
  onChange,
}: {
  label: string;
  provider: ProviderValue;
  model: string | undefined;
  ollamaModels: readonly string[];
  disabled?: boolean;
  onChange: (provider: ProviderValue, model: string) => void;
}) {
  const base = provider === "ollama" ? ollamaModels : curatedModelsFor(provider);
  const models = model && !base.includes(model) ? [model, ...base] : base;
  const firstFor = (p: ProviderValue): string =>
    (p === "ollama" ? ollamaModels[0] : curatedModelsFor(p)[0]) ?? "";

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className="flex gap-2">
        <select
          className={SELECT_CLASS}
          value={provider}
          disabled={disabled}
          onChange={(e) => {
            const p = e.target.value as ProviderValue;
            onChange(p, firstFor(p));
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className={`${SELECT_CLASS} flex-1`}
          value={model ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(provider, e.target.value)}
        >
          {models.length === 0 ? (
            <option value="">{provider === "ollama" ? "loading…" : "—"}</option>
          ) : null}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [reusableRuns, setReusableRuns] = useState<ReusableRun[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/test/api/ollama-models");
        const body = (await res.json().catch(() => ({}))) as { models?: string[] };
        if (body.models) setOllamaModels(body.models);
      } catch {
        // Non-fatal — the picker still offers Claude/DeepSeek and the current value.
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/test/api/runs");
        const body = (await res.json().catch(() => ({}))) as { runs?: ReusableRun[] };
        // Only runs whose ingest (Stage 4) landed can have it reused.
        if (body.runs) setReusableRuns(body.runs.filter((r) => r.stagesComplete >= 1));
      } catch {
        // Non-fatal — the picker just offers "fresh ingest" only.
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/test/api/config");
        const body = (await res.json().catch(() => ({}))) as {
          config?: TestRunConfig;
          error?: string;
        };
        if (!res.ok || !body.config) throw new Error(body.error ?? `HTTP ${res.status}`);
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
  // When reusing a prior ingest, the whole `ingest` section (summarizer +
  // chunking + embedding) is inert — bench skips Stage 4 entirely.
  const reuseIngest = !!config?.run.skip_ingest && config.run.skip_ingest.trim() !== "";

  const runLabel = (r: ReusableRun): string => {
    const recall =
      r.metrics?.recallAt5 !== undefined
        ? ` · recall@5 ${(r.metrics.recallAt5 * 100).toFixed(0)}%`
        : ` · ${r.status}`;
    return `${r.runId}${recall}`;
  };

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
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">
                  Ingest source (reuse a prior ingest for clean reader A/Bs)
                </Label>
                <select
                  className={SELECT_CLASS}
                  value={config.run.skip_ingest ?? ""}
                  disabled={locked}
                  onChange={(e) =>
                    update((c) => (c.run.skip_ingest = e.target.value || undefined))
                  }
                >
                  <option value="">Fresh ingest (re-run Stage 4)</option>
                  {reusableRuns.map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {runLabel(r)}
                    </option>
                  ))}
                </select>
                {reuseIngest ? (
                  <p className="text-muted-foreground text-xs">
                    Reusing this run&apos;s vector store — the Ingest section below is ignored.
                  </p>
                ) : null}
              </div>
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
                <div className="col-span-2">
                  <RoleModelPicker
                    label="Reader (system under test)"
                    provider={config.run.reader.provider}
                    model={config.run.reader.model}
                    ollamaModels={ollamaModels}
                    disabled={locked}
                    onChange={(provider, model) =>
                      update((c) => {
                        c.run.reader.provider = provider;
                        c.run.reader.model = model;
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <RoleModelPicker
                    label="Summarizer (ingest)"
                    provider={config.ingest.summarizer.provider}
                    model={config.ingest.summarizer.model}
                    ollamaModels={ollamaModels}
                    disabled={locked || reuseIngest}
                    onChange={(provider, model) =>
                      update((c) => {
                        c.ingest.summarizer.provider = provider;
                        c.ingest.summarizer.model = model || undefined;
                      })
                    }
                  />
                </div>
              </div>
            </section>

            {/* Ingest tunables — inert when reusing a prior ingest. */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                Ingest{reuseIngest ? " (ignored — reusing prior ingest)" : ""}
              </h3>
              <div
                className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${
                  reuseIngest ? "pointer-events-none opacity-50" : ""
                }`}
                aria-disabled={reuseIngest}
              >
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
