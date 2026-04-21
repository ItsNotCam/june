<!-- author: Claude -->
# packages/next

Next.js 16 frontend for the june monorepo.

## Stack

- **Next.js 16.2.4** with App Router, React 19, TypeScript strict
- **Tailwind v4** with shadcn/ui (Tailwind v4 compatible)
- **Bun** runtime — use `bun dev`, not `npm`/`node`

## Running

```bash
cd packages/next
bun dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Structure

```
app/
  layout.tsx          ← Root layout with ThemeProvider and Geist fonts
  globals.css         ← Tailwind v4 theme tokens
  typography.ts       ← Typography scale constants
  preview/
    page.tsx          ← Component/design preview page
components/
  PreviewCharts.tsx   ← Recharts-based chart showcase
  theme/
    ThemeProvider.tsx ← next-themes provider wrapper
    ThemeToggle.tsx   ← Server component shell
    ThemeToggleClient.tsx ← Client-side theme toggle button
  ui/
    button.tsx        ← shadcn Button
    card.tsx          ← shadcn Card
    chart.tsx         ← shadcn Chart (recharts wrapper)
lib/
  utils.ts            ← shadcn cn() helper
```

## Adding shadcn components

```bash
bunx shadcn@latest add <component>
```
