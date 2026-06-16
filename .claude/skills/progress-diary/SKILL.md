---
name: progress-diary
description: Record a progress-diary entry after a large, multi-step change lands and is verified. Use when you have just exited plan mode, implemented the plan (or finished a substantial phase/feature/non-trivial fix), confirmed the system compiles and tests pass, and committed the work. Writes a dated, structured Markdown entry under .claude/diary/<feature-name>/ capturing the before/after commit hashes, a one-paragraph summary, a plain-English high-level walkthrough, the concrete steps performed, and next steps — so the team keeps a coherent running history of work on each feature.
---

# Progress diary

Keep a coherent, readable history of progress on a feature. After a **large action**
lands — typically: you exited plan mode, implemented the plan, and verified the system
compiles — write one diary entry. Many small edits do not warrant an entry; a phase, a
feature, or a non-trivial fix does.

## Hard rules
- **The diary is committed into the project repo.** Entries live under `.claude/diary/`,
  are tracked in git, and are committed alongside the project — never gitignored, never
  left as loose untracked files. The diary IS part of the project's history.
- **Never include secrets.** A diary entry must never contain API keys, tokens, passwords,
  `.env` values, auth headers, bearer tokens, full credentialed URLs/connection strings, or
  any command output that embeds them. Refer to services generically ("the home Ollama
  host", "the Anthropic key from `.env`") — never the literal secret. When in doubt, redact.

## Trigger — write an entry when ALL of these hold
1. A substantial, multi-step change is complete (e.g. a plan phase, a feature, a meaningful fix).
2. The system **compiles and tests pass** — verify first. Never diary broken or unverified work.
3. The work is **committed** (entries cite commit hashes). If not yet committed, commit it first.

## Steps
1. **Verify** the build: run the project's typecheck and tests. If anything fails, fix it before diarying.
2. **Previous hash** — capture the tip *before* your change is committed:
   `git rev-parse --short HEAD` (run this before the commit, or read the parent of your commit later with `git rev-parse --short HEAD~1`).
3. **Commit** the change following the repo's commit conventions (e.g. the `(feat)`/`(fix)`/… prefix this repo requires). Then capture the **new hash**: `git rev-parse --short HEAD`.
4. **Pick the folder**: `.claude/diary/<feature-name>/` — kebab-case, **one folder per feature/initiative**. Reuse the same folder across phases so the diary accumulates into a timeline.
5. **Name the file** with an ordered, relevant slug, e.g. `NN-short-slug.md` (zero-padded sequence number so entries sort chronologically — `01-…`, `02-…`).
6. **Write** the entry using the exact structure below.
7. **Commit** the diary file into the repo so it ships with the project (a small follow-up
   commit right after the work commit is the clean way — it lets the entry cite the work
   commit's hash). Scan the entry for secrets before committing.

## Entry structure (all sections required, in this order)

```markdown
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
- Write for a future reader skimming the whole diary: clear heading, honest summary, real next steps.
- The **previous → new** commit pair makes each entry a precise, reviewable slice of history.
- Convert relative dates to absolute (`YYYY-MM-DD`).
- If the work is one phase of an approved multi-phase plan, name the folder after the plan/feature and add one entry per phase, so the folder reads as a chronological progress log.
