import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Preview() {
  return (
    <div className="bg-muted/40 min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold tracking-tight">june. component preview</h1>
          <p className="text-muted-foreground mt-1 text-sm">Theming sandbox — shadcn/ui primitives</p>
        </div>

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

        {/* Stats */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Stats</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Chunks indexed", value: "84,231", delta: "↑ 1,204 today", color: "text-foreground" },
              { label: "Avg latency", value: "1.2s", delta: "Under 3s ✓", color: "text-green-600" },
              { label: "Queries today", value: "412", delta: "Peak at 10:42 AM", color: "text-foreground" },
              { label: "Cache hit rate", value: "73%", delta: "↓ 4% this week", color: "text-red-500" },
            ].map(({ label, value, delta, color }) => (
              <div key={label} className="bg-card rounded-xl border p-5 space-y-1">
                <p className="text-muted-foreground text-sm">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value}</p>
                <p className="text-muted-foreground text-xs">{delta}</p>
              </div>
            ))}
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
              <Button>Search</Button>
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
            <span className="text-green-600">success</span>
            <span className="text-yellow-600">warning</span>
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
