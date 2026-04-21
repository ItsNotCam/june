// author: Claude
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

const queryVolumeData = [
  { day: "Mon", queries: 312 },
  { day: "Tue", queries: 287 },
  { day: "Wed", queries: 445 },
  { day: "Thu", queries: 389 },
  { day: "Fri", queries: 502 },
  { day: "Sat", queries: 198 },
  { day: "Sun", queries: 142 },
];

const chunkTypeData = [
  { type: "prose", count: 32140 },
  { type: "code", count: 18420 },
  { type: "list", count: 19521 },
  { type: "table", count: 8910 },
  { type: "heading", count: 5240 },
];

const latencyData = [
  { time: "00:00", p50: 0.8, p95: 2.1 },
  { time: "04:00", p50: 0.7, p95: 1.9 },
  { time: "08:00", p50: 1.2, p95: 3.4 },
  { time: "10:00", p50: 1.8, p95: 4.2 },
  { time: "12:00", p50: 1.4, p95: 3.8 },
  { time: "14:00", p50: 1.1, p95: 3.1 },
  { time: "16:00", p50: 1.3, p95: 3.5 },
  { time: "18:00", p50: 0.9, p95: 2.4 },
  { time: "22:00", p50: 0.7, p95: 1.8 },
];

const cacheData = [
  { name: "hit", value: 73, fill: "var(--color-hit)" },
  { name: "miss", value: 27, fill: "var(--color-miss)" },
];

const queryVolumeConfig: ChartConfig = {
  queries: { label: "Queries", color: "var(--chart-1)" },
};

const chunkTypeConfig: ChartConfig = {
  count: { label: "Chunks", color: "var(--chart-1)" },
};

const latencyConfig: ChartConfig = {
  p50: { label: "p50", color: "var(--chart-1)" },
  p95: { label: "p95", color: "var(--chart-4)" },
};

const cacheConfig: ChartConfig = {
  hit: { label: "Hit", color: "var(--chart-1)" },
  miss: { label: "Miss", color: "var(--chart-3)" },
};

export function PreviewCharts() {
  return (
    <>
      {/* Charts row — query volume + chunk types */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Charts</h2>
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Query volume</CardTitle>
              <CardDescription>Queries per day — last 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={queryVolumeConfig} className="h-48 w-full">
                <LineChart data={queryVolumeData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs"
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="queries"
                    type="monotone"
                    stroke="var(--color-queries)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--color-queries)" }}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chunk types</CardTitle>
              <CardDescription>Distribution across the corpus</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chunkTypeConfig} className="h-48 w-full">
                <BarChart data={chunkTypeData} layout="vertical">
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    dataKey="type"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={52}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={3} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Area chart — latency p50 + p95 */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Latency</CardTitle>
            <CardDescription>p50 and p95 response time (seconds) over 24 h</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={latencyConfig} className="h-52 w-full">
              <AreaChart data={latencyData}>
                <defs>
                  <linearGradient id="fillP50" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-p50)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-p50)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillP95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-p95)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--color-p95)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} unit="s" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="p95"
                  type="monotone"
                  stroke="var(--color-p95)"
                  strokeWidth={2}
                  fill="url(#fillP95)"
                />
                <Area
                  dataKey="p50"
                  type="monotone"
                  stroke="var(--color-p50)"
                  strokeWidth={2}
                  fill="url(#fillP50)"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>

      {/* Cache donut — left half of the cache+alerts row */}
      <Card>
        <CardHeader>
          <CardTitle>Cache hit rate</CardTitle>
          <CardDescription>Last 24 hours — 73% overall</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <ChartContainer config={cacheConfig} className="h-40 w-40 shrink-0">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={cacheData}
                dataKey="value"
                nameKey="name"
                innerRadius={36}
                outerRadius={60}
                strokeWidth={0}
              />
            </PieChart>
          </ChartContainer>
          <div className="space-y-2">
            {cacheData.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: `var(--color-${d.name})` }}
                />
                <span className="capitalize text-muted-foreground">{d.name}</span>
                <span className="ml-auto font-mono font-semibold">{d.value}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
