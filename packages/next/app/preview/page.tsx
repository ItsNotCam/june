import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreviewCharts } from "@/components/PreviewCharts";

const RECENT_ACTIVITY = [
  { id: "q-4821", query: "explain the event loop", source: "web", latency: "0.9s", status: "ok" },
  { id: "q-4820", query: "what is memoization", source: "api", latency: "1.4s", status: "ok" },
  { id: "q-4819", query: "compare quicksort vs mergesort", source: "web", latency: "5.2s", status: "slow" },
  { id: "q-4818", query: "redis vs memcached", source: "api", latency: "1.1s", status: "ok" },
  { id: "q-4817", query: "what is hoisting", source: "web", latency: "0.8s", status: "ok" },
  { id: "q-4816", query: "CAP theorem explained", source: "api", latency: "2.3s", status: "warn" },
] as const;

const ALERTS = [
  { type: "error", title: "Embed service unreachable", detail: "3 retries failed — circuit open", time: "2m ago" },
  { type: "warn", title: "Cache hit rate dropped", detail: "73% → 69% in the last hour", time: "14m ago" },
  { type: "info", title: "Re-index completed", detail: "84,231 chunks indexed in 4m 12s", time: "1h ago" },
  { type: "success", title: "Canary deploy passed", detail: "All latency gates under threshold", time: "2h ago" },
] as const;

const STATUS_STYLES = {
  ok: "text-success",
  warn: "text-warning-foreground",
  slow: "text-destructive",
} as const;

const ALERT_STYLES = {
  error: { bar: "bg-destructive", icon: "✕" },
  warn: { bar: "bg-warning", icon: "!" },
  info: { bar: "bg-chart-2", icon: "i" },
  success: { bar: "bg-success", icon: "✓" },
} as const;

export default function Preview() {
  return (
    <div className="bg-muted/40 min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold tracking-tight">june. component preview</h1>
          <p className="text-muted-foreground mt-1 text-sm">Theming sandbox — shadcn/ui primitives</p>
        </div>

        {/* Stats */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Stats</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Chunks indexed", value: "84,231", delta: "↑ 1,204 today", color: "text-foreground" },
              { label: "Avg latency", value: "1.2s", delta: "Under 3s ✓", color: "text-success" },
              { label: "Queries today", value: "412", delta: "Peak at 10:42 AM", color: "text-foreground" },
              { label: "Cache hit rate", value: "73%", delta: "↓ 4% this week", color: "text-destructive" },
            ].map(({ label, value, delta, color }) => (
              <div key={label} className="bg-card rounded-xl border p-5 space-y-1">
                <p className="text-muted-foreground text-sm">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value}</p>
                <p className="text-muted-foreground text-xs">{delta}</p>
              </div>
            ))}
          </div>
        </section>

        <PreviewCharts />

        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
            <CardDescription>Recent system events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ALERTS.map((alert) => {
              const style = ALERT_STYLES[alert.type];
              return (
                <div key={alert.title} className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                  <div className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${style.bar}`}>
                    {style.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">{alert.title}</p>
                    <p className="text-muted-foreground text-xs">{alert.detail}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">{alert.time}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent activity table */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Query</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Latency</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_ACTIVITY.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                  >
                    <td className="px-4 py-3 font-mono text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3 max-w-52 truncate">{row.query}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{row.source}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono">{row.latency}</td>
                    <td className={`px-4 py-3 font-medium ${STATUS_STYLES[row.status]}`}>
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Progress */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Progress</h2>
          <div className="space-y-3">
            {[
              { label: "Embedding coverage", pct: 94 },
              { label: "Metadata completeness", pct: 81 },
              { label: "Freshness score", pct: 67 },
              { label: "Authority signal", pct: 55 },
            ].map(({ label, pct }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="text-muted-foreground font-mono">{pct}%</span>
                </div>
                <div className="bg-muted h-2 w-full rounded-full overflow-hidden">
                  <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Buttons */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Buttons</h2>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon">+</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        {/* Badges */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Badges</h2>
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </section>

        {/* Cards row */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Cards</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card rounded-xl border p-5 space-y-2">
              <p className="font-semibold">Default card</p>
              <p className="text-muted-foreground text-sm">Standard border + background.</p>
              <Button size="sm" className="mt-1">Action</Button>
            </div>
            <div className="bg-primary text-primary-foreground rounded-xl p-5 space-y-2">
              <p className="font-semibold">Primary card</p>
              <p className="text-sm opacity-75">Inverted primary surface.</p>
              <Button size="sm" variant="secondary" className="mt-1">Action</Button>
            </div>
            <div className="bg-muted rounded-xl border p-5 space-y-2">
              <p className="font-semibold">Muted card</p>
              <p className="text-muted-foreground text-sm">Muted background surface.</p>
              <Button size="sm" variant="outline" className="mt-1">Action</Button>
            </div>
          </div>
        </section>

        {/* Inputs */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Inputs</h2>
          <div className="grid grid-cols-2 gap-4">
            <input className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" placeholder="Default input" />
            <input disabled className="border-input bg-muted ring-offset-background placeholder:text-muted-foreground flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none cursor-not-allowed opacity-50" placeholder="Disabled input" />
            <div className="flex gap-2 col-span-2">
              <input className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" placeholder="Search docs..." />
              <Button className="h-full">Search</Button>
            </div>
          </div>
        </section>

        {/* Typography */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Typography</h2>
          <div className="space-y-1">
            <p className="text-4xl font-bold tracking-tight">H1 — The quick brown fox</p>
            <p className="text-3xl font-bold tracking-tight">H2 — The quick brown fox</p>
            <p className="text-2xl font-semibold">H3 — The quick brown fox</p>
            <p className="text-xl font-semibold">H4 — The quick brown fox</p>
            <p className="text-lg font-medium">H5 — The quick brown fox</p>
            <p className="text-base font-medium">H6 — The quick brown fox</p>
          </div>
          <hr className="border-border" />
          <div className="space-y-2">
            <p className="text-base">Body — The quick brown fox jumps over the lazy dog.</p>
            <p className="text-muted-foreground text-sm">Muted — Secondary text, helper descriptions, timestamps.</p>
            <p className="text-muted-foreground text-xs">Small — Fine print, footnotes, version strings.</p>
            <p className="font-mono text-sm text-muted-foreground">Mono — latency: 1.2s / tokens: 2048</p>
          </div>
          <hr className="border-border" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <strong>Strong</strong>
            <em>Emphasis</em>
            <u>Underline</u>
            <del>Deleted</del>
            <s>Strikethrough</s>
            <mark className="bg-yellow-200 px-0.5 rounded">Highlighted</mark>
          </div>
          <hr className="border-border" />
          <div className="flex flex-wrap gap-3 text-sm font-medium">
            <span className="text-primary">primary</span>
            <span className="text-secondary-foreground">secondary</span>
            <span className="text-muted-foreground">muted</span>
            <span className="text-destructive">destructive</span>
            <span className="text-success">success</span>
            <span className="text-warning-foreground">warning</span>
          </div>
        </section>

        {/* Color palette */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Theme palette</h2>
          <div className="flex flex-wrap gap-4">
            {[
              ["bg-background", "background"],
              ["bg-foreground", "foreground"],
              ["bg-card", "card"],
              ["bg-primary", "primary"],
              ["bg-primary-foreground border", "primary-fg"],
              ["bg-secondary", "secondary"],
              ["bg-muted", "muted"],
              ["bg-accent", "accent"],
              ["bg-destructive", "destructive"],
              ["bg-border border", "border"],
              ["bg-chart-1", "chart-1"],
              ["bg-chart-2", "chart-2"],
              ["bg-chart-3", "chart-3"],
              ["bg-chart-4", "chart-4"],
              ["bg-chart-5", "chart-5"],
            ].map(([cls, label]) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <div className={`${cls} size-12 rounded-lg border border-black/10`} />
                <span className="text-muted-foreground text-xs">{label}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
