---
name: engineering-log
description: Record a engineering-log entry after a large, multi-step change lands and is verified. Use when you have just exited plan mode, implemented the plan (or finished a substantial phase/feature/non-trivial fix), confirmed the system compiles and tests pass, and committed the work. Writes a dated, structured Markdown note into the Obsidian vault under the "engineering-log/<feature-name>/" folder (via the obsidian-notes MCP) capturing the before/after commit hashes, a one-paragraph summary, a plain-English high-level walkthrough, the concrete steps performed, and next steps — so the team keeps a coherent running history of work on each feature.
---

# Progress Engineering Log

Keep a coherent, readable history of progress on a feature. After a **large action**
lands — typically: you exited plan mode, implemented the plan, and verified the system
compiles — write one engineering log entry. Many small edits do not warrant an entry; a phase, a
feature, or a non-trivial fix does.

Entries are stored in **Obsidian** (not in the repo). They are written via the
`obsidian-notes` MCP server into the **`engineering-log/`** folder of the vault, with one
subfolder per feature/initiative — Obsidian's folders are just directory paths, so a note
at `engineering-log/<feature-name>/<slug>.md` shows up grouped under that folder in the vault.

## Hard rules
- **The engineering log lives in Obsidian.** Entries are notes under the vault's
  `engineering-log/<feature-name>/` folder, written with the `obsidian-notes` MCP
  (`mcp__obsidian-notes__vault_write`). They are NOT committed to the project repo and are
  NOT loose files under `.claude/`. The engineering log is the team's running history, kept in the vault.
- **Never include secrets.** A engineering log entry must never contain API keys, tokens, passwords,
  `.env` values, auth headers, bearer tokens, full credentialed URLs/connection strings, or
  any command output that embeds them. Refer to services generically ("the home Ollama
  host", "the Anthropic key from `.env`") — never the literal secret. When in doubt, redact.

## Trigger — write an entry when ALL of these hold
1. A substantial, multi-step change is complete (e.g. a plan phase, a feature, a meaningful fix).
2. The system **compiles and tests pass** — verify first. Never log broken or unverified work.
3. The work is **committed** (entries cite commit hashes). If not yet committed, commit it first.

## Steps
1. **Verify** the build: run the project's typecheck and tests. If anything fails, fix it before logging.
2. **Previous hash** — capture the tip *before* your change is committed:
   `git rev-parse --short HEAD` (run this before the commit, or read the parent of your commit later with `git rev-parse --short HEAD~1`).
3. **Commit** the change following the repo's commit conventions (e.g. the `(feat)`/`(fix)`/… prefix this repo requires). Then capture the **new hash**: `git rev-parse --short HEAD`.
4. **Pick the feature folder**: `engineering-log/<feature-name>/` in the vault — kebab-case, **one folder per feature/initiative**. Reuse the same folder across phases so the engineering log accumulates into a timeline. (`vault_write` creates the folder automatically if it doesn't exist.)
5. **Determine the next sequence number**: list the folder with `mcp__obsidian-notes__vault_list` (path `engineering-log/<feature-name>`), read the existing entries' `sequence` frontmatter, and use the next integer after the highest (start at `1` if the folder is new). This value goes in the `sequence:` field — **not** the filename.
6. **Name the file** with a short, descriptive kebab-case slug only — `<slug>.md`, no number prefix (e.g. `reader-window-sweep.md`). Ordering lives in metadata (`created` + `sequence`), so the filename only needs to describe the entry.
7. **Write** the note with `mcp__obsidian-notes__vault_write` (path `engineering-log/<feature-name>/<slug>.md`, `content` = the entry below). Scan the content for secrets before writing. If the write fails with a socket/connection or re-authorization error, the Obsidian app or its Local REST API may be offline — tell the user to ensure Obsidian is running and re-authorize via `/mcp`, then retry.

## Entry structure (all sections required, in this order)

Every entry **opens with YAML frontmatter** so it is searchable via the `obsidian-notes`
MCP (`search_query` over fields, `search_simple` over text) without anyone reading the
whole note. Fill every field. To keep the `tags`/`type` vocabulary consistent (and avoid
near-duplicate tags that fragment search), read `_templates/CONVENTIONS.md` from the vault root with
`mcp__obsidian-notes__vault_read` if unsure, and reuse an existing tag rather than coining
a new one.

```markdown
---
title: <same as the heading below>
type: engineering-log
feature: <feature-name>            # matches the engineering-log/<feature-name>/ folder
sequence: <N>                      # order within the feature (1, 2, 3 …); the sort tiebreaker
project: june
status: in-progress               # in-progress | complete — this phase's state
tags: [eng-log, <feature-name>]   # add area/* and tech/* tags as relevant (see _templates/CONVENTIONS)
created: <YYYY-MM-DD>
prev_commit: <previous-short-hash>
new_commit: <new-short-hash>
summary: <one line: what this entry accomplished — the highest-value search field>
keywords: []                      # synonyms/jargon/abbreviations to catch keyword search
aliases: []                       # alternate names this entry should be findable under
---

# <Clear, specific heading — what this entry is about>

<One paragraph, plain prose: what this change accomplished and why it mattered.
Include the headline result/number if there is one. Be honest about what is and
isn't finished.>

**Commits:** `<previous-short-hash>` → `<new-short-hash>`   ·   <YYYY-MM-DD>

## What happened (high level)
<A jargon-light walkthrough — the kind you'd give a teammate who wasn't in the
weeds. Cover what was built, the key decisions or surprises, and the outcome.
Short paragraphs or bullets. This is the section a future reader skims first.>

## Steps performed
<The concrete work, in order: which files/areas changed and what each did, plus
how it was verified (typecheck/tests/run). Enough detail to retrace the work.>

## Action items / next steps
- <Concrete next step>
- <…as many as necessary; leave none implicit>
```

## Notes
- **Frontmatter is mandatory and drives search.** Keep `feature`, `tags`, and `status`
  consistent across a feature's entries so `search_query` can pull a feature's whole
  timeline (`WHERE feature = "<name>"`) and `status` filters find unfinished phases. Put
  jargon/abbreviations in `keywords` so `search_simple` finds entries by terms not in the
  prose. Follow `[[CONVENTIONS]]` for the controlled tag/type vocabulary — invent a new tag
  only when none fits.
- **Order by metadata, not filename.** Filenames are slug-only (no number prefix); sort a
  feature's entries with `SORT created ASC, sequence ASC` in Dataview. `sequence` is the
  tiebreaker when several entries share a `created` date.
- Write for a future reader skimming the whole engineering log: clear heading, honest summary, real next steps.
- The **previous → new** commit pair makes each entry a precise, reviewable slice of history.
- Convert relative dates to absolute (`YYYY-MM-DD`).
- If the work is one phase of an approved multi-phase plan, name the folder after the plan/feature and add one entry per phase, so the folder reads as a chronological progress log.
- Obsidian-friendly touches are welcome but optional: `[[wiki-links]]` between related entries, and `#tags` for the feature — these make the log easier to navigate in the vault.
