import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreviewCharts } from "@/components/layout/PreviewCharts";
import { PreviewForm } from "@/components/layout/PreviewForm";
import { PreviewSidebar } from "@/components/layout/PreviewSidebar";

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

const DOCUMENTS = [
  { id: "doc-0091", name: "quickstart.md", source: "github", size: "12 KB", chunks: 48, tokens: 9_812, status: "indexed", updated: "2m ago" },
  { id: "doc-0090", name: "api-reference.md", source: "github", size: "84 KB", chunks: 312, tokens: 64_440, status: "indexed", updated: "2m ago" },
  { id: "doc-0089", name: "architecture.md", source: "notion", size: "31 KB", chunks: 120, tokens: 24_600, status: "indexed", updated: "15m ago" },
  { id: "doc-0088", name: "onboarding.pdf", source: "gdrive", size: "2.1 MB", chunks: 88, tokens: 18_304, status: "indexed", updated: "1h ago" },
  { id: "doc-0087", name: "changelog-v0.9.md", source: "github", size: "8 KB", chunks: 22, tokens: 4_400, status: "indexed", updated: "1h ago" },
  { id: "doc-0086", name: "pricing-deck.pdf", source: "gdrive", size: "4.7 MB", chunks: 0, tokens: 0, status: "failed", updated: "2h ago" },
  { id: "doc-0085", name: "sla-agreement.docx", source: "gdrive", size: "190 KB", chunks: 0, tokens: 0, status: "pending", updated: "2h ago" },
  { id: "doc-0084", name: "ml-design-doc.md", source: "notion", size: "55 KB", chunks: 198, tokens: 41_580, status: "indexed", updated: "3h ago" },
  { id: "doc-0083", name: "infra-runbook.md", source: "github", size: "22 KB", chunks: 76, tokens: 15_580, status: "stale", updated: "1d ago" },
  { id: "doc-0082", name: "user-research-q1.pdf", source: "gdrive", size: "1.3 MB", chunks: 214, tokens: 44_296, status: "indexed", updated: "1d ago" },
  { id: "doc-0081", name: "security-policy.md", source: "notion", size: "18 KB", chunks: 64, tokens: 13_120, status: "stale", updated: "3d ago" },
  { id: "doc-0080", name: "roadmap-2026.md", source: "notion", size: "9 KB", chunks: 33, tokens: 6_864, status: "indexed", updated: "3d ago" },
] as const;

type DocStatus = (typeof DOCUMENTS)[number]["status"];

const DOC_STATUS_STYLES: Record<DocStatus, string> = {
  indexed: "text-success",
  failed: "text-destructive",
  pending: "text-warning-foreground",
  stale: "text-muted-foreground",
};

const SOURCE_LABELS: Record<(typeof DOCUMENTS)[number]["source"], string> = {
  github: "GitHub",
  notion: "Notion",
  gdrive: "Drive",
};

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
    <div className="flex min-h-screen bg-muted/40">
      <PreviewSidebar />
      <div className="flex-1 overflow-y-auto p-8">
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

        {/* Indexed documents table */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Indexed documents</h2>
          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Size</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Chunks</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Tokens</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Updated</th>
                </tr>
              </thead>
              <tbody>
                {DOCUMENTS.map((doc, i) => (
                  <tr key={doc.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{doc.id}</td>
                    <td className="px-4 py-3 max-w-40 truncate font-medium">{doc.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{SOURCE_LABELS[doc.source]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{doc.size}</td>
                    <td className="px-4 py-3 text-right font-mono">{doc.chunks > 0 ? doc.chunks.toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{doc.tokens > 0 ? doc.tokens.toLocaleString() : "—"}</td>
                    <td className={`px-4 py-3 font-medium ${DOC_STATUS_STYLES[doc.status]}`}>{doc.status}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{doc.updated}</td>
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

        <PreviewForm />

        {/* Skeleton loaders */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Skeletons</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-muted animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
              </div>
            </div>
            <div className="h-3 w-full rounded bg-muted animate-pulse" />
            <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
            <div className="h-3 w-4/6 rounded bg-muted animate-pulse" />
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          </div>
        </section>

        {/* Team / avatars */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Team</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { name: "Jordan Lee", role: "Founder", initials: "JL", color: "bg-chart-1 text-white" },
              { name: "Alex Rivera", role: "ML Engineer", initials: "AR", color: "bg-chart-2 text-white" },
              { name: "Sam Okafor", role: "Backend", initials: "SO", color: "bg-chart-3 text-white" },
              { name: "Mina Cho", role: "Design", initials: "MC", color: "bg-chart-4 text-white" },
              { name: "Dev Patel", role: "Infra", initials: "DP", color: "bg-chart-5 text-white" },
              { name: "Lena Müller", role: "Product", initials: "LM", color: "bg-primary text-primary-foreground" },
              { name: "Omar Jalloh", role: "Security", initials: "OJ", color: "bg-destructive text-white" },
              { name: "Yuki Tanaka", role: "Frontend", initials: "YT", color: "bg-muted text-foreground" },
            ].map(({ name, role, initials, color }) => (
              <div key={name} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className={`size-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${color}`}>
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-xs text-muted-foreground truncate">{role}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Timeline */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Timeline</h2>
          <ol className="relative border-l border-border ml-3 space-y-6">
            {[
              { time: "10:42 AM", title: "Peak query load hit", body: "412 req/min sustained for 3 minutes. All SLOs held.", color: "bg-success" },
              { time: "09:15 AM", title: "Re-index triggered", body: "84,231 chunks queued after source update from GitHub sync.", color: "bg-chart-2" },
              { time: "08:50 AM", title: "Embed service degraded", body: "Circuit breaker opened after 3 consecutive timeouts.", color: "bg-destructive" },
              { time: "08:00 AM", title: "Canary deploy started", body: "v0.9.4 rolled out to 10% of traffic. Latency gates nominal.", color: "bg-primary" },
              { time: "Yesterday", title: "Schema migration complete", body: "Chunk metadata v2 fully backfilled — 99.97% success rate.", color: "bg-chart-5" },
            ].map(({ time, title, body, color }) => (
              <li key={title} className="ml-5">
                <span className={`absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-card ${color}`} />
                <p className="text-xs text-muted-foreground mb-0.5 font-mono">{time}</p>
                <p className="text-sm font-semibold leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Keyboard shortcuts */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {[
              ["Open command palette", ["⌘", "K"]],
              ["New query", ["⌘", "N"]],
              ["Search docs", ["/"]],
              ["Toggle sidebar", ["⌘", "B"]],
              ["Focus embed input", ["⌘", "E"]],
              ["Re-index now", ["⌘", "⇧", "R"]],
              ["Open settings", ["⌘", ","]],
              ["Logout", ["⌘", "⇧", "Q"]],
            ].map(([label, keys]) => (
              <div key={label as string} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{label as string}</span>
                <span className="flex gap-1">
                  {(keys as string[]).map((k) => (
                    <kbd key={k} className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground shadow-sm">
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Code block */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Code</h2>
          <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">
            <code>
              <span className="text-muted-foreground">{"// embed a document chunk\n"}</span>
              <span className="text-chart-2">{"import "}</span>
              <span className="text-foreground">{"{ embed } "}</span>
              <span className="text-chart-2">{"from "}</span>
              <span className="text-chart-1">{"'@june/mcp'"}</span>
              <span className="text-foreground">{";\n\n"}</span>
              <span className="text-chart-2">{"const "}</span>
              <span className="text-chart-3">{"result"}</span>
              <span className="text-foreground">{" = "}</span>
              <span className="text-chart-2">{"await "}</span>
              <span className="text-chart-3">{"embed"}</span>
              <span className="text-foreground">{"({\n"}</span>
              <span className="text-foreground">{"  content: "}</span>
              <span className="text-chart-1">{"'The quick brown fox jumps over the lazy dog'"}</span>
              <span className="text-foreground">{",\n"}</span>
              <span className="text-foreground">{"  model:   "}</span>
              <span className="text-chart-1">{"'nomic-embed-text'"}</span>
              <span className="text-foreground">{",\n"}</span>
              <span className="text-foreground">{"  source:  "}</span>
              <span className="text-chart-1">{"'docs/quickstart.md'"}</span>
              <span className="text-foreground">{",\n});\n\n"}</span>
              <span className="text-muted-foreground">{"// result.vector.length === 768\n"}</span>
              <span className="text-chart-3">{"console"}</span>
              <span className="text-foreground">{"."}</span>
              <span className="text-chart-2">{"log"}</span>
              <span className="text-foreground">{"(result.id, result.vector.length);"}</span>
            </code>
          </pre>
        </section>

        {/* Pricing cards */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pricing</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                name: "Hobby",
                price: "$0",
                period: "forever",
                desc: "For side projects and tinkering.",
                features: ["1 knowledge source", "10k chunks", "100 queries/day", "Community support"],
                cta: "Get started",
                variant: "outline" as const,
                highlight: false,
              },
              {
                name: "Pro",
                price: "$29",
                period: "per month",
                desc: "For developers shipping products.",
                features: ["10 knowledge sources", "500k chunks", "Unlimited queries", "API access", "Email support"],
                cta: "Start free trial",
                variant: "default" as const,
                highlight: true,
              },
              {
                name: "Enterprise",
                price: "Custom",
                period: "contact us",
                desc: "For teams with serious scale.",
                features: ["Unlimited sources", "Unlimited chunks", "SLA guarantee", "SSO / SAML", "Dedicated support"],
                cta: "Contact sales",
                variant: "secondary" as const,
                highlight: false,
              },
            ].map(({ name, price, period, desc, features, cta, variant, highlight }) => (
              <div
                key={name}
                className={`rounded-xl border p-6 space-y-5 flex flex-col ${
                  highlight ? "bg-primary text-primary-foreground border-primary" : "bg-card"
                }`}
              >
                <div>
                  <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${highlight ? "opacity-75" : "text-muted-foreground"}`}>{name}</p>
                  <p className="text-3xl font-bold">{price}</p>
                  <p className={`text-xs mt-0.5 ${highlight ? "opacity-60" : "text-muted-foreground"}`}>{period}</p>
                  <p className={`text-sm mt-2 ${highlight ? "opacity-80" : "text-muted-foreground"}`}>{desc}</p>
                </div>
                <ul className="space-y-1.5 flex-1">
                  {features.map((f) => (
                    <li key={f} className={`flex items-center gap-2 text-sm ${highlight ? "opacity-90" : ""}`}>
                      <span className={highlight ? "opacity-70" : "text-success"}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button variant={variant} className="w-full">{cta}</Button>
              </div>
            ))}
          </div>
        </section>

        {/* Notification toasts */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Toasts</h2>
          <div className="max-w-sm space-y-2">
            {[
              { title: "Deploy succeeded", body: "v0.9.4 is live on production.", border: "border-l-success", icon: "✓", iconBg: "bg-success text-white" },
              { title: "Rate limit warning", body: "85% of daily quota used.", border: "border-l-warning", icon: "!", iconBg: "bg-warning text-foreground" },
              { title: "Connection lost", body: "Retrying in 5 seconds…", border: "border-l-destructive", icon: "✕", iconBg: "bg-destructive text-white" },
              { title: "Re-index queued", body: "84,231 chunks scheduled.", border: "border-l-chart-2", icon: "i", iconBg: "bg-chart-2 text-white" },
            ].map(({ title, body, border, icon, iconBg }) => (
              <div key={title} className={`flex items-start gap-3 rounded-lg border bg-background p-3 shadow-sm border-l-4 ${border}`}>
                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${iconBg}`}>{icon}</span>
                <div>
                  <p className="text-sm font-medium leading-tight">{title}</p>
                  <p className="text-xs text-muted-foreground">{body}</p>
                </div>
                <button className="ml-auto text-muted-foreground hover:text-foreground text-xs shrink-0">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Stat sparklines */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Sparklines</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Queries / hr", values: [12, 18, 14, 22, 30, 28, 35, 40, 38, 45, 42, 50], color: "bg-chart-1" },
              { label: "Latency p95 (ms)", values: [800, 950, 870, 1100, 1300, 1050, 900, 850, 1200, 1400, 1100, 950], color: "bg-chart-3" },
              { label: "Cache hits %", values: [70, 72, 71, 69, 68, 73, 75, 74, 72, 70, 69, 73], color: "bg-success" },
            ].map(({ label, values, color }) => {
              const max = Math.max(...values);
              const min = Math.min(...values);
              const range = max - min || 1;
              return (
                <div key={label} className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold font-mono">{values[values.length - 1]}</p>
                  <div className="flex items-end gap-0.5 h-10">
                    {values.map((v, i) => (
                      <div
                        key={i}
                        style={{ height: `${((v - min) / range) * 100}%` }}
                        className={`flex-1 rounded-sm ${color} opacity-80 min-h-[2px]`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Empty states */}
        <section className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Empty states</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: "◈", heading: "No sources yet", body: "Connect a knowledge source to start indexing.", action: "Add source" },
              { icon: "◎", heading: "No queries found", body: "Try a broader search or adjust your filters.", action: "Clear filters" },
              { icon: "⬡", heading: "Embeddings empty", body: "Trigger a re-index to generate embeddings.", action: "Run re-index" },
            ].map(({ icon, heading, body, action }) => (
              <div key={heading} className="flex flex-col items-center text-center rounded-lg border border-dashed p-8 space-y-2">
                <span className="text-3xl text-muted-foreground">{icon}</span>
                <p className="text-sm font-semibold">{heading}</p>
                <p className="text-xs text-muted-foreground">{body}</p>
                <Button variant="outline" size="sm" className="mt-1">{action}</Button>
              </div>
            ))}
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
    </div>
  );
}
