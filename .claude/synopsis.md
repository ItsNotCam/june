<!-- author: Cam -->
# This is june. Here is the synopsis

# june. — Product Planning Synopsis

> **Status:** greenfield, solo build, personal project.
> Starting from scratch on personal equipment and time. Not a rewrite of any prior work — this is june as its own thing, built fresh from this synopsis as the spec.

---

## What june Is

A unified developer knowledge platform. Not a chatbot, not a search engine — a **knowledge interface** that uses natural language as its input method.

**Core philosophy:**

> "It doesn't do the work for you. It empowers you to do the work faster."

june makes a developer feel like a senior engineer on a codebase they've never touched.

---

## The Core Technical Bet

> **If the RAG is elite, the model is almost irrelevant.**

This is the founding technical principle of june. Every RAG optimization decision flows from this.

The goal is not to make Gemma 26b perform like GPT-4. The goal is to make the context window so clean, so scoped, so high-signal that a cheap local model has no choice but to give a correct answer.

```
Bad RAG + expensive model = okay results, high cost
Elite RAG + cheap model   = correct results, nearly free
```

When the model receives:

```
✅ 3 chunks, all relevant, all from the right source
✅ Query already rewritten for precision
✅ Metadata pre-filtered before vector search
✅ Context hard capped at ~2000 tokens
✅ No noise, no tangential content, no wrong source type
```

It doesn't need to be smart. It just needs to read and synthesize. A 26b model can do that flawlessly.

This is the self-hosted pitch in technical form:

> "We don't need OpenAI. We need a great pipeline."

---

## The Four Pillars of Schema Design

Metadata is the control surface of the entire RAG pipeline. Every filter, every scope, every ranking signal depends on it. Get the schema wrong once and you pay for it across 4M vectors forever. So the schema is designed around four pillars, each with a different lifecycle and a different job.

> **Pillar 1 — Identity.** Who/what is this chunk. Immutable.
> **Pillar 2 — Provenance.** Where it came from, how it got here. Updates on re-ingest.
> **Pillar 3 — Classification.** How to scope and filter at query time. Evolves with taxonomy.
> **Pillar 4 — Signals.** Ranking hints, learned continuously. Never required.

Each pillar evolves at its own speed. Identity never changes. Provenance changes on re-ingest. Classification grows as the taxonomy matures. Signals update continuously from user behavior. Keeping them separate means each pillar can be versioned, migrated, and extended independently — without ever re-ingesting the corpus.

**Three rules govern every schema decision:**

```
1. schema_version on every chunk, always. Back compat is non-negotiable.
2. Every new field is optional with a defined default.
   Old chunks stay queryable without re-ingest.
3. Controlled vocabulary on every classification field.
   Free text is how metadata dies at scale.
```

### Pillar 1 — Identity (required, immutable)

```
id               → stable chunk UUID, deterministic from source + offset
doc_id           → parent document UUID
source_type      → "internal" | "external"      (collection boundary)
content_type     → "doc" | "endpoint" | "schema" | "code" | "conversation"
schema_version   → integer, for migrations
```

### Pillar 2 — Provenance (required, updates on re-ingest)

```
source_uri         → canonical URL or path, the "open in source" link
source_system      → "confluence" | "onedrive" | "github" | "openapi" | ...
ingested_at        → ISO timestamp
content_hash       → sha256 of raw content, for dedup + staleness
source_modified_at → from the source system, for staleness detection
ingestion_run_id   → which ingestion job produced this chunk
```

### Pillar 3 — Classification (optional, evolves)

```
namespace         → "org:acme" | "team:platform" | "personal"  (multi-tenancy hook)
project           → free-ish within namespace, "auth-service"
category          → controlled vocab: guide | reference | tutorial
                                     | changelog | runbook | postmortem
                                     | spec | decision-record
tags              → controlled vocab, array: ["compliance", "security", ...]
audience          → controlled vocab, array: ["engineering", "legal", "ops"]
sensitivity       → "public" | "internal" | "confidential" | "restricted"
lifecycle_status  → "draft" | "published" | "deprecated" | "archived"
```

### Pillar 4 — Signals (optional, continuously updated)

```
quality_score     → 0-1, learned from citation frequency + feedback
freshness_score   → 0-1, decays with time, boosted on source update
authority_score   → 0-1, based on source_system + author signals
click_through     → counter, how often this chunk is actually useful
last_validated_at → when a human last confirmed this is correct
deprecated        → boolean, penalization hook
```

### Content-type-specific fields

Namespaced under `type_specific` so the top-level shape stays stable as new content types are added:

```
type_specific:
  # when content_type === "endpoint"
  api_name, method, path, deprecated, tags[]

  # when content_type === "doc"
  doc_name, heading_path[], api_refs[], version

  # when content_type === "code"  (phase 5)
  repo, branch, file_path, symbol_kind, symbol_name, language

  # when content_type === "conversation"  (future)
  channel, participants[], thread_id
```

---

## Making Categorization Painless

The single biggest failure mode of any metadata system is that **nobody populates it**. The schema above is worthless if a user opens an ingestion form and sees twelve dropdowns. They won't fill them in. They'll type whatever gets the doc uploaded fastest. Metadata becomes a lie, filters become untrustworthy, RAG precision collapses at scale.

So the design rule is absolute:

> **The user should never see the metadata schema. june fills it in. The user confirms.**

### The three-step ingestion UX

```
1. Drop a file or paste a URL.
2. june proposes all metadata automatically.
3. User glances, optionally tweaks, confirms.
```

That's the entire interaction. No dropdowns by default. No required fields surfaced. Everything derived.

### How june infers each field

Most fields need no human input at all. Inference strategies, cheapest to most expensive:

**Free from the source** (zero inference cost):
- `source_uri`, `source_system`, `source_modified_at`, `content_hash`, `ingested_at`, `ingestion_run_id` — all observable at ingest
- `content_type` — determined by file type and parser
- `schema_version` — set by the ingester

**Free from the file itself** (regex/parse):
- `doc_name`, `heading_path` — pulled from document structure
- `api_name`, `method`, `path` — pulled from OpenAPI spec
- `version`, `lifecycle_status` — often present in frontmatter or filename conventions

**Inferred by a small fast model** (qwen 3b or similar, one cheap call per doc):
- `category` — "is this a runbook, a guide, a reference?" Easy classification task
- `tags` — top 3-5 from controlled vocab, model picks from the list
- `audience` — who's this written for, based on tone and content
- `project` — matched against known project registry, fuzzy

**Defaulted or org-configured**:
- `namespace` — set by the authenticated user's org/team
- `sensitivity` — defaults to org policy (e.g. "internal" for Confluence, "public" for vendor docs)
- `source_type` — derived from the source_system

### The confirmation UI

After june proposes metadata, the user sees a **single compact card**, not a form:

```
 ┌──────────────────────────────────────────────────┐
 │  auth-service-runbook.md                          │
 │                                                    │
 │  Runbook · Engineering · Internal · Auth Service  │
 │  Tags: compliance, security                        │
 │                                                    │
 │  [ Looks good, ingest ]      [ Adjust ]           │
 └──────────────────────────────────────────────────┘
```

One glance, one click. "Adjust" reveals the full schema only if the user wants it. 95% of ingests are one click.

### The bulk ingest case

For a folder of 400 docs, the same principle applies — but one at a time is untenable. Three affordances:

1. **Preview first five.** june shows proposed metadata on the first 5 docs. User confirms pattern is right, then bulk-applies to the rest.
2. **Confidence flags.** june flags low-confidence inferences (e.g. "I'm not sure if this is a `runbook` or a `postmortem`") and only those get surfaced for review. Everything else goes through silent.
3. **Retroactive correction.** User can change metadata on any chunk later. Corrections feed back into the classifier — next ingest from the same source is more accurate.

### The controlled-vocab registry

Because every classification field is controlled vocab, there's a registry. Not a file the user edits — a surface inside june:

- Admin settings → Taxonomy → see all current tags, categories, audiences
- Adding a new value is deliberate, namespaced, versioned
- The classifier is re-prompted with the current vocab on every run, so new values take effect immediately

This is how metadata stays trustworthy at 4M vectors. Not by forcing rigor on the user — by making the system rigorous on the user's behalf.

### The design principle, compressed

```
Strict schema + loose input + smart inference + confirmation UX
= metadata that's both trustworthy AND painless
```

If the user ever feels like they're doing data entry, the design has failed.

---

## The Problem It Solves

- New devs take weeks to get productive on an unfamiliar stack
- Senior engineers spend 30% of their time answering questions that live somewhere in docs
- Knowledge is spread across Confluence, Slack, vendor docs, and codebases — no single place to ask
- Vendor documentation is massive and incomprehensible (427 pages of Darktrace docs) — the problem isn't finding information, it's building comprehension

---

## What Makes It Unique

- **Entirely self-hosted** — no data leaves the building. HIPAA, legal, finance, defense viable
- **Runs on prosumer hardware** — Gemma 4:26b, Ollama, local vector DB
- **Indexes YOUR stack** — internal docs AND vendor APIs in one place
- **Not a replacement** — an amplifier. Devs stay in control
- **Comprehension first** — not a better search, a better way to understand
- **Cheap models, correct answers** — elite RAG means you never need expensive cloud inference

---

## The Entry Flow

```
Open june
   ↓
"What are you working on?" → type subject line (mandatory)
   ↓
Pick a mode → [Search] [Quick] [SME] [Conversational]
   ↓
Mode determines what happens next
```

Subject line is mandatory. It's the thread anchor — like an email subject. Persistent, returnable, shareable. Scopes all retrieval within that thread.

---

## The Four Modes

### Search
- No AI. Pure ranked results.
- Filter before: internal/external, docs/specs
- Sort after: relevance, recency, source
- Result format: title + one line of context, Google-style
- "Ask june" button on any result escalates to AI mode

### Quick
- Fast answer, move on
- 2-3 chunks max, tight retrieval
- One paragraph, answer first, no preamble
- Offers to go deeper, doesn't by default

### SME
- Comprehension first, details second
- Boots with a map: core entities, how they connect, primary operations, key gotchas
- Broad retrieval, cross-source, high chunk count
- Thorough, cited, connects dots across entire indexed knowledge base
- Graph view always available as a companion lens — entities and relationships rendered visually, interactive
- Related topics shown passively after every answer — never pushy, always present like Wikipedia links
- Asks one scoping question before answering

### Conversational
- Boots with: "what are you trying to figure out?"
- User drives entirely — june never volunteers information unprompted
- One follow-up question at a time, socratic
- june removes friction, user does the thinking

---

## What The UI Feels Like

- **Not a chatbot UI** — a knowledge interface
- Command bar entry, not a chat bubble
- Subject line → mode selector → input. In that order, every time
- Mode selector: horizontal tabs, always visible, one click, self-explanatory labels
- Response anatomy: answer zone → sources zone → passive related links
- Sources always visible, always specific, always clickable
- Two layers on every answer: the answer itself + exactly where it came from
- History feels like a log, not a conversation
- Compact, scannable
- "Open in git" link on every code reference — mandatory, not optional (phase 3)

---

## Why june Doesn't Feel Optional Like Other AI Doc Tools

Most AI doc tools fail because:

```
1. They summarize instead of map — lossy, untrustworthy
2. They don't show enough context — can't verify, can't go deeper
3. They're bolted on — ctrl+F is still faster
```

june solves this by:

```
1. Mental model first — entities, relationships, operations, gotchas
   before a single detail is discussed

2. Every answer has two visible layers — the answer AND the exact
   sources it drew from, specific and clickable, not hidden

3. Progressive comprehension — june remembers what you've covered
   in this thread and builds on it, never re-explains what you know

4. Passive doorways — related topics always visible, never demanded
   like Wikipedia links, not like a chatbot prompt

5. Gives you something ctrl+F literally cannot — a map of how
   427 pages connect, built instantly from indexed content
```

---

## The Tech Stack

```
Runtime       → Bun
Language      → TypeScript (strict)
HTTP          → Hono
MCP           → @modelcontextprotocol/sdk
Vector DB     → Qdrant
Collections   → internal + external (domain boundaries)
Embeddings    → nomic-embed-text or jina-embeddings-v2-base-code via Ollama
               (benchmark both against actual content before committing)
Provenance    → SQLite sidecar for ingestion state tracking
Frontend      → Next.js 15, React 18, Tailwind v4, Zustand, shadcn/ui
AI model      → Gemma 4:26b (local), Claude (cloud fallback)
```

---

## The Phased Build Plan

### Phase 1 — Foundation (greenfield)
- Project skeleton: Bun + TypeScript (strict) + Hono + Next.js 15
- Qdrant running locally, two collections (`internal`, `external`), empty
- Schema v1 in Qdrant payloads — Pillar 1 + Pillar 2 + minimal Pillar 3 (`category`, `tags`, `sensitivity`)
- `schema_version: 1` on every chunk from commit #1
- `namespace` populated (default to `"default"` in solo dev)
- **Identity-shaped holes:** every query accepts an `identity` object `{ user_id, groups[], max_sensitivity }` even if hardcoded in dev mode. Retrieval pre-filter uses it. Audit log records it. All no-ops today, real in phase 4.
- Ingest ONE source type end-to-end (markdown files) — ugly but working
- One end-to-end query path: ingest → embed → retrieve → respond, with citations
- Coding style locked in from file #1 — no conversion step later
- **Success:** I can ingest a folder, ask a question, get a cited answer on local hardware. No polish, but every subsequent phase has something to build on.

### Phase 2 — RAG Quality (highest priority)
- Query rewriting step before vector search
- Intent detection → collection routing (`internal`, `external`, or both)
- Metadata pre-filter: `sensitivity`, `lifecycle_status`, `deprecated`, identity-scoped
- `MAX_EMBED_CHARS`: 4096
- `maxDistance`: 0.55
- 3-chunk hard cap, no exceptions
- `api_refs` relevance boost
- Signal-weighted ranking scaffolding (fields present, scores defaulted)
- **Embedding model benchmark:** nomic-embed-text vs jina-v2-base-code on 50 representative docs + 20 representative queries. Pick based on data, not vibes. 2 hours of work, unblocks everything.
- **Latency budget:** written down and enforced. Target: Quick under 3s, SME under 8s on prosumer hardware. If the pipeline can't hit it, simplify the pipeline.
- **Success:** the founding bet is validated or falsified. Gemma 26B gives cited answers that feel correct, on local hardware, within the latency budget.

### Phase 3 — Surfaces (Dev UI + HR UI)
- Dev UI first, nail it completely
- Subject line → mode selector → input entry flow
- Response anatomy: answer → sources → passive related links
- Compact, command-bar feel — no chat bubbles
- Max content width ~720px, GitBook-quality typography
- Text selection → floating toolbar → summarize/explain in side drawer
- Sticky table of contents for long docs
- Graph view companion in SME mode
- **HR UI as the second surface** — built while dev UI is still fresh, forces the abstraction to stay clean
- HR surface: big search box, no mode selector visible, plain-language responses, named sources only (not file paths), no dev jargon
- Audience layer architecture: role determines surface, surface determines defaults (density, mode visibility, language)
- **Success:** a developer loves it AND a non-technical person can use it without help.

### Phase 4 — Auth & Identity
- OIDC integration — june as an OIDC client, customer brings their own IdP (Keycloak / Authentik / Authelia / Okta / Azure AD / Google Workspace)
- Bundled Keycloak docker-compose as the onramp for customers without an IdP
- Real identity populates the stubs from phase 1 — groups map to `namespace` and `max_sensitivity`
- `sensitivity` becomes enforced, not decorative — restricted chunks never enter the retrieval pool for users without clearance
- Audit log goes live with real user_ids, retention per org policy
- Admin surface: role mapping, surface assignment, override rules
- Surface switcher for users in multiple groups (e.g. eng manager who's also in HR-Team)
- **Success:** june respects who you are. A Legal user cannot retrieve engineering internals even if they ask for them by name.

### Phase 5 — Context Management
- Tiered context slots: system prompt → rolling summary → RAG results → last 3 messages
- Rolling summary updated by small fast model (qwen 3b or similar)
- Tool result compression — raw JSON never hits the model
- Auto-summarize at 35k tokens
- Hard cap total context at ~8k tokens per request

### Phase 6 — Codebase Indexing
- Integrate Continue's indexing core (Apache 2.0)
- Tree-sitter AST parsing — symbol level: functions, classes, libraries, patterns
- CI hook on push to master → auto re-index
- "Open in git" link on every code reference becomes meaningful

### Phase 7 — Ingestion Expansion
- PDF → pdf-parse → markdown → chunker
- DOCX → mammoth → markdown → chunker
- OneDrive folder watching via Microsoft Graph API
- HTML paste → markdown conversion → ingest pipeline
- Staleness detection on `lastModifiedDateTime`
- Store original files in full, downloadable anytime

### Phase 8 — Auto-Classification at Ingest (deferred)
- Build the inference pipeline: source-derived → file-parsed → model-classified → defaulted
- Small-model classifier (qwen 3b or similar) with controlled-vocab constraint
- Confirmation UI — single card, one click, "Adjust" escape hatch
- Bulk ingest: preview first 5, confidence-flagged review, silent pass-through for high-confidence
- Retroactive correction feeds back as classifier training signal
- **Deferred on purpose:** until there's real usage data on how users actually classify things, the classifier is harder to build and will be worse. For phases 1-7, ingestion uses a simple dropdown (category, tags, sensitivity) at upload time. That solves the problem for every realistic use case until auto-classification earns its spot.

---

## RAG Optimization Best Practices

### The Mandate
RAG quality is the highest priority engineering concern in the entire project. Every decision about chunking, metadata, retrieval, and context management exists to serve one goal: give a cheap local model such clean, precise, scoped context that it has no choice but to return a correct answer. This is non-negotiable and never deprioritized.

### Collection Strategy
- Two Qdrant collections: `internal` and `external`
- Collection is the primary scope boundary — metadata filters within
- Query intent determines which collection(s) to hit before any vector search

### Metadata Schema
The full schema is defined in *The Four Pillars of Schema Design*. At retrieval time, the pipeline filters on Pillar 1 (identity) and Pillar 3 (classification), boosts on Pillar 4 (signals), and uses Pillar 2 (provenance) for staleness/freshness penalties. Content-type-specific fields (endpoint paths, heading paths, api_refs) live under `type_specific` and are used by the ranker when content_type matches.

### Retrieval Pipeline
```
User query
   ↓
Query rewriting — expand vague natural language before embedding
   ↓
Intent detection — internal | external | both
   ↓
Collection selection — hit the right collection(s) only
   ↓
Metadata pre-filter — source_type, lifecycle_status, deprecated, tags
   ↓
Vector search — fetch n * 4 candidates
   ↓
api_refs boost — promote chunks referencing queried API
   ↓
Signal-weighted ranking — quality, freshness, authority
   ↓
Distance filter — drop anything above 0.55
   ↓
Return top 3 — hard cap, no exceptions
```

### Embed Text Quality
- `MAX_EMBED_CHARS`: 4096
- Format: `breadcrumb path + content` — context always included
- Never embed raw truncated text without heading context

### Model Context Budget
- Total RAG context hard capped at ~2000 tokens
- Tool results compressed before entering context
- Penalize deprecated and unstable results

---

## Competitive Position

- **Glean** — closest competitor, $40k+/year, cloud only. june is self-hosted at a fraction of the cost
- **Notion AI, Confluence, GitBook** — no deep private ingestion, cloud only
- **Cursor, Claude Code** — IDE tools, not competitors

---

