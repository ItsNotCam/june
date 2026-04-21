<!-- author: Claude -->
---
paths:
  - "packages/next/**"
---

## Styling

Priority order: shadcn components → Tailwind utilities → inline styles (computed values only, never for static colors).

**Colors:** Use Tailwind semantic utilities only — `bg-background`, `text-foreground`, `text-primary`, `text-muted-foreground`, `border-border`, etc. All tokens are mapped in `packages/next/app/globals.css`. Never write raw color values (oklch, hsl, rgba, hex) unless the value must be computed at runtime (e.g. a lerp).

Reference the shadcn llms.txt when implementing shadcn components: https://ui.shadcn.com/llms.txt
