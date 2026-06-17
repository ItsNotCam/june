"use client";
// author: Claude
/**
 * Quality-over-time line chart for the `/test` page. Fetches the same
 * `/test/api/runs` list as RunHistory (refetching whenever `refreshKey` bumps),
 * keeps only runs that reached scoring, and plots answers-correct, recall@5, and
 * MRR as three series on a shared 0–100% axis so trends are comparable at a
 * glance. Oldest run on the left, newest on the right.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { RunListItem } from "@/lib/test/run-store";

/** Each series is a fraction (0–1) scaled to a percentage point for plotting. */
type ChartPoint = {
  label: string;
  answersCorrect?: number;
  recallAt5?: number;
  mrr?: number;
};

const CHART_CONFIG: ChartConfig = {
  answersCorrect: { label: "answers correct", color: "var(--chart-1)" },
  recallAt5: { label: "correct source in top 5", color: "var(--chart-2)" },
  mrr: { label: "avg ranking of correct source", color: "var(--chart-4)" },
};

const toPct = (n?: number): number | undefined => (n === undefined ? undefined : n * 100);

const shortLabel = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Oldest-first series of scored runs, ready to feed straight into the chart. */
const toPoints = (runs: RunListItem[]): ChartPoint[] =>
  runs
    .filter((r) => r.metrics)
    .slice()
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
    .map((r) => ({
      label: shortLabel(r.completedAt ?? r.startedAt),
      answersCorrect: toPct(r.metrics?.readerCorrectPct),
      recallAt5: toPct(r.metrics?.recallAt5),
      mrr: toPct(r.metrics?.mrr),
    }));

export function ResultsChart({ refreshKey }: { refreshKey: number }) {
  const [points, setPoints] = useState<ChartPoint[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/test/api/runs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { runs: RunListItem[] };
      setPoints(toPoints(body.runs));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Results over time</CardTitle>
        <CardDescription>Headline quality metrics across scored runs (oldest → newest)</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {points && points.length === 0 ? (
          <p className="text-muted-foreground text-sm">No scored runs yet.</p>
        ) : null}
        {points && points.length > 0 ? (
          <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
            <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} className="text-xs" />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={40}
                unit="%"
                className="text-xs"
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                dataKey="answersCorrect"
                type="monotone"
                stroke="var(--color-answersCorrect)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                dataKey="recallAt5"
                type="monotone"
                stroke="var(--color-recallAt5)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                dataKey="mrr"
                type="monotone"
                stroke="var(--color-mrr)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ChartContainer>
        ) : null}
      </CardContent>
    </Card>
  );
}
