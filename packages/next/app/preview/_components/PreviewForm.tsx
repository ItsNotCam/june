// author: Claude
"use client";

import { Button } from "@/components/ui/button";

/** Fake form section for the preview page — client component so onSubmit is valid. */
export function PreviewForm() {
  return (
    <section className="bg-card rounded-xl border p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Form (for no reason)</h2>
        <p className="text-muted-foreground text-sm mt-0.5">Does nothing. Looks great.</p>
      </div>
      <form suppressHydrationWarning className="space-y-5" onSubmit={(e) => e.preventDefault()}>

        {/* Name row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="first-name">First name</label>
            <input suppressHydrationWarning id="first-name" placeholder="Alex" className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="last-name">Last name</label>
            <input suppressHydrationWarning id="last-name" placeholder="Smith" className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" />
          </div>
        </div>

        {/* Email + URL */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <input suppressHydrationWarning id="email" type="email" placeholder="you@example.com" className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" />
            <p className="text-xs text-muted-foreground">We'll never share this. Probably.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="website">Website</label>
            <div className="flex">
              <span className="border-input bg-muted text-muted-foreground inline-flex items-center rounded-l-md border border-r-0 px-3 text-sm">https://</span>
              <input suppressHydrationWarning id="website" placeholder="june.dev" className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-r-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2" />
            </div>
          </div>
        </div>

        {/* Select + range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="plan">Plan</label>
            <select suppressHydrationWarning id="plan" className="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 appearance-none">
              <option>Hobby — free forever</option>
              <option>Pro — $29/mo</option>
              <option>Enterprise — let's talk</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="chunks">Max chunks <span className="text-muted-foreground font-normal font-mono">500k</span></label>
            <input id="chunks" type="range" min={10} max={1000} defaultValue={500} className="w-full accent-primary h-10" />
          </div>
        </div>

        {/* Textarea */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="bio">Tell us about your use case</label>
          <textarea suppressHydrationWarning id="bio" rows={3} placeholder="We're building a RAG pipeline for internal docs..." className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 resize-none" />
        </div>

        {/* Radio group */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Preferred embedding model</legend>
          <div className="grid grid-cols-3 gap-3 mt-1">
            {["nomic-embed-text", "text-embedding-3-small", "mxbai-embed-large"].map((model, i) => (
              <label key={model} className="flex items-center gap-2.5 rounded-lg border bg-muted/30 p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors">
                <input type="radio" name="model" defaultChecked={i === 0} className="accent-primary" />
                <span className="text-sm font-mono">{model}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Checkboxes */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Notify me when…</legend>
          <div className="space-y-2 mt-1">
            {[
              ["embed-fail", "Embed service goes down", true],
              ["reindex-done", "Re-index completes", true],
              ["query-spike", "Query rate spikes above threshold", false],
              ["cache-drop", "Cache hit rate drops below 70%", false],
            ].map(([id, label, checked]) => (
              <label key={id as string} className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" id={id as string} defaultChecked={checked as boolean} className="size-4 rounded accent-primary" />
                <span className="text-sm">{label as string}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Toggle row */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Feature flags</p>
          {[
            ["Streaming responses", true],
            ["Experimental re-ranker", false],
            ["Debug query traces", false],
          ].map(([label, on]) => (
            <div key={label as string} className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
              <span className="text-sm">{label as string}</span>
              <button
                type="button"
                role="switch"
                aria-checked={on as boolean}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${on ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>
          ))}
        </div>

        {/* File upload */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Upload config</label>
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-8 text-center gap-2">
            <span className="text-2xl text-muted-foreground">⬡</span>
            <p className="text-sm font-medium">Drop your <span className="font-mono">config.yaml</span> here</p>
            <p className="text-xs text-muted-foreground">or</p>
            <Button variant="outline" size="sm" type="button">Browse files</Button>
          </div>
        </div>

        {/* Submit row */}
        <div className="flex items-center justify-between border-t pt-5">
          <p className="text-xs text-muted-foreground">* Required fields (there are none, this form is fake)</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost">Cancel</Button>
            <Button type="submit">Save changes</Button>
          </div>
        </div>

      </form>
    </section>
  );
}
