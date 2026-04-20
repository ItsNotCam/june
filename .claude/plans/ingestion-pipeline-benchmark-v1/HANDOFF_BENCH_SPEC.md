# Handoff Brief — `june-eval` spec authoring

**Purpose:** You (a fresh Claude session) are being handed a fully-planned spec to author. All design decisions are made. Your job is to write `BENCH_SPEC.md` v2 per the decisions below, following the voice, shape, and rigor of the user's existing `SPEC.md`.

**Author of this brief:** A prior Claude session that planned the spec collaboratively with Cam across multiple rounds. Context was getting bloated; rather than degrade the final spec, planning was snapshotted here for a clean handoff.

**Audience for the final spec:** Claude Code, who will implement it.

---

## 0. What you need open before writing

1. **`SPEC.md`** (the user will provide it). The june ingestion-pipeline spec. Read it — at minimum §1, §3, §6–§10, §21, §28, §29. Your spec should cite SPEC.md sections *accurately* (read them, don't paraphrase from this brief). The voice and structure of your spec should mirror SPEC.md closely (Parts I–VII, numbered sections, explicit decisions, pitfalls appendix).
2. **Cam's `cam-style` skill** (`/mnt/skills/user/cam-style/SKILL.md`). Apply to any TypeScript code samples. Read before writing code.
3. **Cam's `Writing Tests` skill** (referenced in user memory, BugMagnet/Gojko Adzic conventions). Reference in §40 Testing Philosophy — don't re-derive.
4. **User preferences:** relaxed tone of a 30-year-old engineer, emojis sparingly, avoid overcomplication, compliment good ideas occasionally, avoid excessive bullets — prefer prose where it works.

---

## 1. The one-line mission

Write `BENCH_SPEC.md` — a spec for `june-eval`, a standalone synthetic-corpus RAG-quality benchmark tool that sits beside june (not inside it), measures retrieval + reader quality end-to-end, and serves as a regression detector for pipeline changes.

It is NOT the throughput harness in SPEC.md §28. The two are siblings, fully separate. Your spec should say this explicitly in the header.

---

## 2. The three use cases `june-eval` must serve (v1)

Ranked by priority — v1 must hit #1 and #2 cleanly; #3 is acknowledged as partial:

1. **Bar question** — Does june's retrieval + 14B reader beat no-RAG Opus on the ingested corpus? (SPEC.md §1's stated bar.) Fictional corpus makes this answerable — no training-data contamination.
2. **Regression detection** — Given a pipeline change, did quality move up, down, or stay flat? Confidence intervals required to separate signal from noise.
3. **Partial — retrieval quality on a synthetic proxy for real docs.** v1 uses fictional corpora, which is a proxy for Cam's actual docs. Catches gross regressions; may miss domain-specific ones. Full version (real-doc-derived corpus) is a v2 concern; the spec should acknowledge this limitation, not paper over it.

Non-goals (document explicitly in §3):
- Not a production eval / not a marketing number
- Not a model-shopping tool (one reader per run)
- Not a training signal
- Not continuous (no dashboard, no scheduled runs)
- Not a substitute for manual review

---

## 3. Proposed TOC (sign-off already given — use this)

```
Header block:
  - Scope, relationship to SPEC.md §28, audience (Claude Code), runtime (Bun + TS strict)
  - Planning provenance note (this brief)

Part I — Foundations
  1. Purpose and scope
  2. Why synthetic
  3. Success criteria + non-goals
  4. The honesty audit (what could make this lie) — L1 through L14
  5. Architecture overview (diagram + flow)
  6. The four LLM roles

Part II — The Data Model
  7. Facts as source of truth
  8. Fact schema (atomic + relational)
  9. Corpus, queries, and ground-truth artifacts
  10. Ground-truth resolution (two-tier: substring + embedding fallback)

Part III — Query Tiers
  11. Tier specifications (T1–T5)
  12. Anti-leakage strategy
  13. Multi-chunk expected answers (T3 + T4)

Part IV — The Pipeline
  14. Stage overview
  15. Stage 1 — Fact generation (deterministic, seeded, no LLM)
  16. Stage 2 — Corpus generation (LLM role 1)
  17. Stage 3 — Query generation (LLM role 2)
  18. Stage 4 — Ingest (delegated to june)
  19. Stage 5 — Ground-truth resolution
  20. Stage 6 — Retrieval evaluation
  21. Stage 7 — Reader evaluation (LLM role 3)
  22. Stage 8 — Judging (async, Anthropic Batch API)
  23. Stage 9 — Scoring, confidence intervals, and report

Part V — Multi-provider LLM abstraction
  24. Provider interface
  25. Role assignment + default config
  26. Anthropic Batch API specifics (submit / poll / retrieve)
  27. Cost preview, rate limits, budget caps

Part VI — Operational surfaces
  28. CLI (generate / run / report / compare / health)
  29. Configuration (env vars + bench.yaml)
  30. Output format (results.json, summary.md, compare.md)
  31. Reproducibility and determinism
  32. Resumability

Part VII — Contracts
  33. TypeScript types (minimal strict types)
  34. Zod schemas (LLM response + config boundaries ONLY — ~3–4 schemas total)
  35. Interface boundaries (Retriever, Judge — both pluggable)

Part VIII — Implementation Guidance
  36. Module file structure
  37. Dependency list (Bun, zod, Anthropic SDK, OpenAI SDK, Ollama fetch)
  38. What Claude Code should produce
  39. What Claude Code should NOT produce
  40. Testing philosophy (reference Cam's "Writing Tests" skill; don't re-derive)
  41. Claude Code TODOs (R1, R2 investigation notes)

Part IX — Appendices
  A. Query tier examples (concrete T1–T5 with Glorbulon-style fictional entities)
  B. Risk register (R1–R9) with mitigations
  C. Decision log (DD-1 through DD-4, Q1–Q5) — for Claude Code to understand WHY
  D. Prompt sketches (corpus author, query author per tier, judge)
  E. Minimum viable retriever adapter (until june's retrieval API lands)
  F. Cost estimation math (pilot N=250, full N=500, Sonnet via Batch API)
  G. Confidence interval math (bootstrap recipe, ~50 lines pseudocode)
  H. Refusal phrase list (for T5 judging)
```

---

## 4. Design decisions — locked in

These were debated and decided. Do not re-open them; document them as settled.

### DD-1 Fact granularity → **Atomic + relational**
- Simple facts: `(entity, attribute, value)`
- Relational facts: `(subject, predicate, object)` — required to enable T4 multi-hop
- No narrative / causal facts in v1 (judge-bias risk; SPEC §18 stage does classification but reading-level claims are out of scope)

### DD-2 Query authorship → **Fully LLM-generated**
- Corpus author (role 1) and query author (role 2) default to **different providers** to reduce lexical collusion
- Anti-leakage via token-overlap check (40% threshold, tunable) + explicit prompt instruction
- Templates explicitly rejected (too synthetic) — but anti-leakage is a bounded problem, not a solved one (flag this)

### DD-3 Judge → **Single LLM judge, Sonnet via Anthropic Batch API, pluggable interface**
- **Sonnet**, not Opus (Opus is overkill for grading against an expected answer)
- **Anthropic Batch API only** — never the synchronous API. Cam was explicit and repeated. This is 50% cheaper, fits the "async regression run" model, and keeps costs low enough for regular use.
- **Pluggable** — interface allows a future `ProgrammaticJudge` (exact-match for T1/T2) to short-circuit LLM calls. Note this in the spec as a v2 door-opener; do not build the programmatic path in v1.
- Judge stage is **async** — submit batch → poll → retrieve. Stage 8 architecture reflects this.

### DD-4 Tool name → **`june-eval`**
- Package name: `june-eval` (unscoped)
- CLI name: `june-eval`
- Explicitly separate from SPEC.md §28 throughput bench. Different tool, different concerns, no shared code.

---

## 5. Open questions — all resolved

### Q1 Ground-truth resolution → **Two-tier: substring + embedding fallback**
- **Tier 1:** whitespace-normalized substring match of planted sentence against chunk content. Fast, deterministic, free.
- **Tier 2:** if Tier 1 fails, embed the planted sentence via Ollama, query Qdrant within the same `doc_id` only, accept the highest-scoring chunk if similarity ≥ threshold (default 0.85, tunable).
- Three outcomes per fact: `resolved_substring` / `resolved_embedding` / `unresolved`.
- **Integrity thresholds:** abort run if `unresolved > 2%` OR `resolved_embedding > 20%` (the latter suggests chunker is mangling sentences).
- **Doc-scoping is the key insight** — fallback search is scoped to the known `doc_id`, preventing cross-doc false positives.
- Spec this as its own pipeline stage (§19), not a footnote.

### Q2 Query count → **Pilot 250, scale to 500 max**
- v1 defaults to 250 queries for first runs
- Scale up to 500 if CI widths warrant it
- Hard ceiling at 500 — Cam explicit: "no more than 500"
- Bench warns about noise below ~200 queries

### Q3 Reader prompt template → **Content-only (Option B), simpler prompt**
- Contextual summary folded into chunk content, not exposed as a separate labeled field
- Can add structured-fields template as a config option later; v1 ships one template

### Q4 T3 multi-chunk expected → **Supported**
- `expected_fact_ids` is an array, even for T3
- Scoring: "any expected chunk in top-K counts as recall=1"
- T4 is different — requires **all** expected chunks in top-K (multi-hop needs both facts)

### Q5 T5 refusal detection → **Explicit refusal phrase list + manual audit**
- Judge prompt includes list of recognized refusal patterns ("I don't have that information", "Based on the provided context, I cannot answer", etc. — full list in Appendix H)
- Manual spot-check of ~10 T5 verdicts per run recommended in spec
- If refusal detection rate drifts, operator tunes the phrase list

---

## 6. Invariants — non-negotiable design rules

Fold these into relevant sections; call them out explicitly.

**I-EVAL-1: Every number carries provenance.** No bare aggregate metric — each one links back to per-query records (queries, retrieved chunks, judge verdicts) via IDs. Drives the `results.json` structure in §30.

**I-EVAL-2: Confidence intervals on every aggregate.** 95% CI via bootstrap resampling (1000 iterations, 2.5/97.5 percentiles). Pseudocode in Appendix G. No point estimate reported without an interval. Cam was explicit: full CIs, not headline-only.

**I-EVAL-3: Run metadata is sacred.** Every `results.json` records: fixture hash, provider+model per role, june embedding model at ingest time, retrieval config snapshot, schema version. `compare` refuses to diff mismatched fixtures by default (`--force` override with warning).

**I-EVAL-4: Determinism where possible, honest about where not.** Fact generation, ground-truth resolution, scoring = pure/deterministic. LLM stages = non-deterministic, documented. Practical guidance: compare runs against the same fixture, not across regenerations.

**I-EVAL-5: Fixture/run separation.** Expensive (fixture) and cheap (run) stages are separate CLI subcommands. Regenerating a fixture is not a side effect of running a benchmark.

**I-EVAL-6: Budget caps.** Every paid provider call is metered. Operator sets `max_budget_usd`; bench aborts mid-run if exceeded. Cost preview before run unless `--yes`.

---

## 7. The four LLM roles

One of the most load-bearing design elements. Each role is independently pluggable across Ollama / Anthropic / OpenAI.

| # | Role | Purpose | Quality bar | Default |
|---|------|---------|-------------|---------|
| 1 | **Corpus author** | Render structured facts into natural technical prose | Medium-high | Anthropic Sonnet |
| 2 | **Query author** | Generate per-tier questions from facts | Medium | OpenAI GPT-4 class |
| 3 | **Reader** *(SUT)* | Answer queries given retrieved chunks | *this is what we're measuring* | Ollama, 14B |
| 4 | **Judge** | Grade reader answers | High — via **Batch API only** | Anthropic Sonnet via Batch |

**Design rule:** roles 1 and 2 should default to *different* providers (collusion reduction). Operator can override.

**Not offline-capable:** Cam was explicit — this tool reaches out to external LLM providers. That's the whole point. Do NOT include SPEC.md's offline invariant (I10) in this spec. Note the difference explicitly to avoid confusion.

---

## 8. The honesty audit — L1 through L14

Include these verbatim (or near-verbatim) in §4. This is load-bearing; front-loading it forces readers to confront failure modes before design details.

| # | Name | What could lie to us | Mitigation in v1 |
|---|------|----------------------|------------------|
| L1 | Keyword leakage | Same LLM writing corpus + queries picks the same distinctive words, inflates T1/T2 | Different providers by default, anti-leakage prompt, 40% overlap threshold |
| L2 | Training-data contamination | Opus "already knows" real facts; no-RAG baseline artificially high | Fictional domain; no real facts in v1 |
| L3 | Judge bias toward verbose/confident answers | Fluent hallucinations score higher than terse correct answers | Structured rubric, calibrated prompt, Sonnet is adequate |
| L4 | Fixture overfitting | Tuning retrieval against one fixture for months → overfit to its quirks | Recommend fixture regeneration quarterly; `compare` refuses cross-fixture diffs |
| L5 | Ground-truth drift | Substring match fails silently when chunker normalizes; shrinks recall denominator | Two-tier resolution (§19), integrity thresholds |
| L6 | Small-N noise | Low query counts have huge variance | Default 250, ceiling 500, CIs mandatory |
| L7 | Synthetic ≠ real | Fictional prose tidier than Cam's actual docs | Document explicitly; v2 plans real-doc-derived mode |
| L8 | Reader variance across runs | Temp=0 still varies for Anthropic/OpenAI | CIs capture this; prefer deterministic configs |
| L9 | T5 scoring ambiguity | "Refused correctly" vs "low top-1 score" — neither is ground truth | Report both separately |
| L10 | Provider mismatch across regression runs | Run A uses Anthropic corpus, Run B uses OpenAI → incomparable | Run manifest records all providers; `compare` refuses mismatches |
| L11 | Chunk-count gaming | Larger K trivially improves Recall@K | Pinned K per metric; report Recall@{1,3,5,10} |
| L12 | Cherry-picked tier weighting | Macro vs. micro avg changes headline number | Both reported; operator can't switch silently |
| L13 | Cost caching | LLM response caching saves $ but means "same run twice" isn't a re-run | Caching disabled by default; if enabled, flagged in manifest |
| L14 | Silent judge failures | Malformed JSON → default → happens to be "correct" → inflated metric | Explicit `UNJUDGED` bucket; capped as integrity metric |

---

## 9. Risk register — R1 through R9

Include verbatim in Appendix B. Two of these are explicit Claude Code TODOs (Cam's call).

| # | Risk | Mitigation | Claude Code action |
|---|------|------------|-------------------|
| R1 | june's ingested chunk schema may not support substring match for ground truth (whitespace/punctuation normalization) | Two-tier resolver with normalized match + embedding fallback | **Claude Code TODO:** investigate june's chunker stage and document actual normalizations applied |
| R2 | Qdrant+SQLite adapter couples to june's internals | Read `schema_version` at startup; hard-fail on mismatch | **Claude Code TODO:** ensure june's current codebase exposes the schema version and chunk content needed by the adapter; if not, PR the minimal changes |
| R3 | Ollama concurrency bottleneck — 14B reader serves ~1–2 concurrent | Configurable concurrency cap; upfront time estimate | Surface in `health` command output |
| R4 | LLM-generated corpus doesn't contain planted facts verbatim (rephrasing, spelling-out numbers) | Post-generation validator per doc; retry up to 3× with tighter reprompt | Validator is a real module, not a `try/catch` |
| R5 | Anti-leakage is fundamentally semantic, not lexical | Accept + document; 40% overlap is a heuristic floor | No code mitigation; flag in §12 |
| R6 | Stale fixtures compared against new runs | Fixture hash in manifest; `compare` hard-refuses mismatch without `--force` | Central logic in compare command |
| R7 | LLM provider API shape changes | Pin SDK versions in `package.json`; don't aggressively upgrade | `package.json` uses exact versions, not ranges |
| R8 | Cost blowouts on misconfigured runs | Cost preview + confirmation gate; `max_budget_usd` hard cap aborts mid-run | Budget-check before each provider call |
| R9 | Embedder mismatch between bench (for Tier 2 resolution) and june's ingest | Bench reads june's ingest manifest, uses same embedder model; hard-fail at startup on mismatch | Startup check in `health` and `run` commands |

---

## 10. Constraints

**Hard (must respect):**
- Bun + TypeScript strict (`I12` from SPEC.md). No `any`.
- june's retrieval API does not yet exist. Ship a stopgap adapter (Appendix E) that hits Qdrant + SQLite directly; designed to be swapped.
- Three providers: Ollama, Anthropic, OpenAI. All four roles independently pluggable.
- **Anthropic Batch API only**, never sync. This is load-bearing architectural choice — stage 8 is async.
- No shared code with june. Separate package; reads june's outputs via public shapes only.

**Soft (strong preferences):**
- <15 min for retrieval-only run, <5 min ideal
- <$5 per full run at default config (pilot N=250 should be well under this)
- Deterministic ground-truth layer

---

## 11. Query tiers — use these examples verbatim

Appendix A should ground the spec in concrete examples. Use the "Glorbulon Protocol" fictional domain from earlier planning — it's invented enough to have zero training-data overlap.

Planted facts (for examples):
- **F1:** Glorbulon Protocol uses port 7733 for control messages *(simple)*
- **F2:** Glorbulon depends on Froznet v2 *(relational)*
- **F3:** Froznet v2 encodes payloads with CBOR *(simple)*

Tier examples:
- **T1 Lexical:** "What port does the Glorbulon Protocol use for control messages?" → expected: chunk with F1
- **T2 Paraphrase:** "Which TCP endpoint does Glorbulon reserve for command-plane traffic?" → expected: chunk with F1
- **T3 Conceptual:** "I'm writing firewall rules for Glorbulon. Which port should I allow for management traffic?" → expected: chunk with F1 (scenario → fact inference)
- **T4 Multi-hop:** "What encoding does the protocol Glorbulon depends on use for payloads?" → expected: chunks with F2 AND F3 (both required in top-K)
- **T5 Negative:** "What port does the Snorblath Protocol use?" → expected: no planted fact, reader should refuse, top-1 score should be low

---

## 12. Anthropic Batch API — this deserves its own section (§26)

Cam was explicit: **Batch API only, never sync.** The spec needs to cover:

- Request shape: array of message requests with `custom_id` per query
- Submit endpoint + response (returns batch ID)
- Polling cadence (suggest 30s with exponential backoff, max 24h timeout)
- Retrieve results: each result tagged with its `custom_id` → map back to query
- Error modes: per-request failures within a successful batch (partial failures — handle gracefully, count as UNJUDGED)
- What happens if a batch expires (24h limit) without completing — surface clearly to operator

**Fresh session: verify the current API shape against Anthropic's docs.** Do not write the section from memory. Use web_fetch or the Anthropic MCP if available. The API shape is the one thing most likely to be wrong if written from priors.

---

## 13. Prompt sketches — Appendix D needs real prompts

Don't hand-wave. Write actual prompts for:

1. **Corpus author** — takes facts list + domain theme, returns `{ markdown, fact_locations }`. Must instruct: embed facts in natural surrounding paragraphs, one sentence per fact, no frontmatter, no meta-references ("fact f001").
2. **Query author T1 (lexical)** — reuse content words naturally
3. **Query author T2 (paraphrase)** — anti-leakage instruction with excluded-word list
4. **Query author T3 (conceptual)** — scenario/goal framing, anti-leakage
5. **Query author T4 (multi-hop)** — takes fact chain, produces single question requiring both
6. **Query author T5 (negative)** — domain-adjacent entity/attribute not in fact list; post-check that no planted fact answers it
7. **Reader** — content-only template (Option B per Q3). Temperature 0. Chunks in `<chunk id=...>...</chunk>` blocks. System prompt: answer from context only, refuse if not in context, cite chunk_ids.
8. **Judge** — classify into `CORRECT | PARTIAL | INCORRECT | REFUSED | HALLUCINATED | UNJUDGED`. For T5, REFUSED is CORRECT. JSON output, zod-validated, 2 retries then fallback to UNJUDGED.

Each prompt should be 15–40 lines of detail, not a vague sketch.

---

## 14. Style notes

**Voice:** Match SPEC.md. Confident, opinionated, willing to say "this is how it is and here's why." Cam's existing spec uses phrases like "the bar", "the load-bearing decision", "operator-trusted". Pick that register up.

**Structure:** Part I–IX, numbered sections, per-section headers in the shape SPEC.md uses. Tables for comparative decisions. Prose for reasoning. Minimal bullets — SPEC.md mostly uses prose, and Cam's preference file confirms this.

**Length:** SPEC.md is ~4,300 lines. This spec is smaller in scope — target ~1,500–2,000 lines. Don't pad. Don't under-explain either — Claude Code needs enough detail to implement without interpreting.

**Tone notes from Cam's preferences:**
- Relaxed, 30-year-old engineer voice
- Emojis sparingly (1–3 per long document, at natural punctuation moments — not decorative)
- Avoid overcomplication
- Compliments on good ideas okay, but this is a spec, not a chat — keep self-narration minimal

**What NOT to do:**
- Don't re-open the decisions in Section 4/5 of this brief
- Don't speculate about future features (v2 is explicitly out of scope, except as door-openers)
- Don't invent SPEC.md section numbers — read the file
- Don't write code that doesn't respect cam-style (read the skill)
- Don't describe the planning process that led here — the decision log in Appendix C is enough

---

## 15. Output placement

Write the spec to `/mnt/user-data/outputs/BENCH_SPEC.md` and surface it via `present_files`. One file, markdown, same shape as SPEC.md.

---

## 16. Final checklist for the fresh session

Before writing, confirm:
- [ ] SPEC.md is read (at minimum the sections cited above)
- [ ] Cam's cam-style skill is read
- [ ] Anthropic Batch API shape is verified against current docs (not memory)
- [ ] The TOC in §3 of this brief is understood and will be followed
- [ ] All decisions in §4, §5, §7 are treated as settled
- [ ] The honesty audit (§8) and risk register (§9) will be included verbatim-ish
- [ ] Claude Code TODOs (R1, R2) are flagged in §41 of the final spec
- [ ] The decision log (Appendix C) will be populated from §4, §5 of this brief

After writing, sanity-check:
- [ ] Every section is internally consistent (no contradictions between §7 and §34's schemas, e.g.)
- [ ] Every "see §X" reference resolves correctly
- [ ] SPEC.md citations are accurate (section numbers, not paraphrased)
- [ ] No mention of Opus as judge (it's Sonnet)
- [ ] No mention of sync Anthropic API (it's Batch only)
- [ ] No mention of offline invariant (doesn't apply here)
- [ ] Glorbulon/Froznet examples appear in Appendix A and nowhere else (unless directly referenced)

---

*End of handoff brief.*
