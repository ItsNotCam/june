# june.

A unified developer knowledge platform. Not a chatbot, not a search engine — a knowledge interface that uses natural language as its input method.

> "It doesn't do the work for you. It empowers you to do the work faster."

june makes a developer feel like a senior engineer on a codebase they've never touched.

---

## AI usage disclosure

This project is built with significant AI assistance via [Claude Code](https://claude.ai/code) (Anthropic).

---

## What it is

june indexes your internal docs, vendor APIs, and codebases into a single queryable knowledge base running entirely on local hardware. No data leaves the building.

The founding technical bet:

> **If the RAG is elite, the model is almost irrelevant.**

Every engineering decision flows from this. The goal isn't to run GPT-4 — it's to make the context window so clean and precise that a cheap local model (Gemma 26b, Ollama) has no choice but to give a correct answer.

**Four query modes:**
- **Search** — pure ranked results, no AI
- **Quick** — fast answer, tight retrieval, one paragraph
- **SME** — comprehension first: entities, relationships, operations, gotchas — before any detail
- **Conversational** — socratic, user-driven, june removes friction

**The UI is not a chatbot.** It's a knowledge interface — command bar entry, subject line as thread anchor, sources always visible and clickable, history as a log.

**Self-hosted, self-sufficient:**
- Runs on prosumer hardware
- Vector search via Qdrant
- Embeddings via Ollama (nomic-embed-text or jina-v2-base-code)
- SQLite sidecar for ingestion provenance
- No cloud dependency — HIPAA, legal, finance, defense viable

**Full synopsis:** [`.claude/synopsis.md`](.claude/synopsis.md)

---

## Monorepo layout

```
june/
  packages/
    next/       — @june/next        Next.js 16 frontend
    shared/     — @june/shared      shared types, env/config/logger scaffolding
    mcp/
      ingest/   — @june/mcp-ingest  markdown ingestion pipeline + june CLI
      bench/    — @june/mcp-bench   synthetic-corpus RAG-quality eval (june-eval CLI)
      server/   — @june/mcp-server  MCP JSON-RPC server (scaffold)
```

Bun workspace root. All packages are TypeScript strict, `"type": "module"`, Bun runtime.

---
