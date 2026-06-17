<!-- author: Claude -->
---
title: Dev Workflow
type: reference
status: active
tags: [project/june, area/devops, meta/workflow]
project: june
area: devops
created: 2026-06-17
summary: The commit / README / reader-mode workflow conventions that govern how changes get made in june.
keywords: [commit conventions, conventional commits, workflow, reader mode, readme rule, pretooluse hook]
aliases: [dev workflow]
---

# Dev Workflow

> The project-specific disciplines that govern *how* changes get made in june: the
> **commit / README** conventions and the bench **reader-by-purpose** rule.

---

## 1. Commit workflow

From [`CLAUDE.md`](../../CLAUDE.md). Commit messages **start with a conventional type in
parens**: `(feat)`, `(fix)`, `(chore)`, `(refactor)`, `(docs)`, `(test)`, `(style)`,
`(perf)`, `(ci)`, `(build)`.

Commit normally — no authorship tracking and no `Co-authored-by` trailers.

### READMEs after every commit

After committing, update the README of any package whose files changed (create one if
missing). Update the **root** README if the change affects overall structure or public
API. (This `.claude/docs/` set is the deeper companion to those package READMEs.)

---

## 2. Reader-by-purpose (bench discipline)

A hard rule for anyone running `@june/mcp-bench`. The reader model is chosen **by
purpose — you know which, you don't ask**:

- **Iterating / fast loop** → `june-eval run … --mode iterate` (reader
  `deepseek-v4-flash`). A **directional scratchpad ONLY** — never "expected results."
- **Benchmarking / certifying** → `june-eval run … --mode control` (reader
  `gemma4:26b`, the 24 GB BYO-AI reference). **The authoritative bar.**
- **Ad-hoc bake-off** → explicit `--reader-provider/--reader-model` (freeform; never a
  baseline).

Every run must declare intent (no `--mode`/`--reader-*` → hard error, enforced by
`scripts/validate-reader-mode.sh`, a PreToolUse hook). Flash deltas are hypotheses; the
`control` run is the verdict. A change that helps flash but regresses gemma is overfit.
Gate batches with `june-eval control-check` against `golden.json`. Full rules:
`packages/mcp/bench/CLAUDE.md` and `src/lib/modes.ts`. See also
[03 — Bench & evaluation](./03-bench-evaluation.md) §3.

> **Bench is a gauge, not a goal** — optimize real RAG comprehension, never the bench
> percentage (Goodhart). No studying-to-pass.

---

## 3. Local hooks & permissions

- `.claude/settings.json` — PreToolUse hook on `Bash` → `scripts/validate-reader-mode.sh`.
- `.claude/settings.local.json` — a permissions allow-list (`bun --eval`,
  `bun run typecheck`, `gh pr *`, `git checkout/merge *`, `bun update *`,
  `sqlite3 *`) and `enabledMcpjsonServers: ["june-mcp"]`.
