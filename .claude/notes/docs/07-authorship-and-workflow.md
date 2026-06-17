---
title: Authorship Tracking & Dev Workflow
type: reference
status: active
tags: [project/june, area/devops, meta/workflow]
project: june
area: devops
created: 2026-06-17
summary: The authorship-tracking system (per-file Claude attribution) and the commit / README / reader-mode workflow conventions.
keywords: [authorship, attribution, commit conventions, posttooluse hook, workflow, reader mode, track-authorship]
aliases: [dev workflow, authorship tracking]
---

# Authorship Tracking & Dev Workflow

> Two project-specific disciplines that govern *how* changes get made in june: the
> **authorship-tracking** system (who wrote what, reflected in commit attribution) and
> the **commit / README / reader-mode** workflow conventions.

---

## 1. Authorship tracking

June records, per file, how much of the current uncommitted work is Claude's, and
attributes commits accordingly. Three moving parts:

### a) The recorder — `scripts/track-authorship.sh` (PostToolUse hook)

Fires after every `Write`/`Edit`. Reads the tool JSON from stdin, and for the touched
file:

- untracked file → all lines count as Claude's;
- tracked file → counts only added (`+`) diff lines since the last commit;
- appends a JSONL record to `.claude/scratch/authorship.jsonl` (under `flock`):

```json
{"ts":"2026-04-21T00:05:16Z","file":"scripts/check-authorship.sh","tool":"Write","claude_adds":71,"total":71}
```

It also flips a `// author:` comment to `Claude` if Claude's share crosses 50%.

### b) The reporter — `scripts/check-authorship.sh`

Run **before writing any commit message**. For each staged file it reads the latest
JSONL record and computes `claude_adds / total_lines`, then groups:

- **Claude-primary** (> 50%) → commit **with** trailer
  `Co-authored-by: Claude <claude@anthropic.com>`
- **Cam-primary** (≤ 50%, or no tracking data) → commit **without** the trailer

### c) Tests — `scripts/__test__/authorship.test.sh`

Isolated temp-repo tests covering the counting, the 50% boundary (exactly 50% →
Cam-primary), the author-comment flip, and the deleted-file exclusion.

> The `.jsonl` is a session scratchpad (gitignored); **git commit trailers are the
> authoritative record.** The metric is per-session contribution since the last
> commit, not lifetime authorship.

---

## 2. Commit workflow

From [`CLAUDE.md`](../../CLAUDE.md). Always:

1. Run `bash scripts/check-authorship.sh`.
2. Commit messages **start with a conventional type in parens**: `(feat)`, `(fix)`,
   `(chore)`, `(refactor)`, `(docs)`, `(test)`, `(style)`, `(perf)`, `(ci)`, `(build)`.

**All files in one group:** single commit, with or without the trailer as appropriate.

**Split case (files in both groups):**

```bash
git restore --staged .
git add <claude-primary files>   # commit WITH Co-authored-by: Claude <claude@anthropic.com>
git add <cam-primary files>      # commit WITHOUT the trailer
```

> The same rule, set globally for the user: in the **june** repo run
> `check-authorship.sh` first and attribute per-file; in **all other repos** (no
> tracking) add **no** co-author lines.

### READMEs after every commit

After committing, update the README of any package whose files changed (create one if
missing). Update the **root** README if the change affects overall structure or public
API. (This `.claude/docs/` set is the deeper companion to those package READMEs.)

---

## 3. Reader-by-purpose (bench discipline)

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

## 4. Local hooks & permissions

- `.claude/settings.json` — PreToolUse hook on `Bash` →
  `scripts/validate-reader-mode.sh`. (The PostToolUse authorship hook is wired
  separately.)
- `.claude/settings.local.json` — a permissions allow-list (`bun --eval`,
  `bun run typecheck`, `gh pr *`, `git checkout/merge *`, `bun update *`,
  `sqlite3 *`) and `enabledMcpjsonServers: ["june-mcp"]`.
