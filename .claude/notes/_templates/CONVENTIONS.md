---
title: Vault Conventions
type: reference
status: active
tags: [meta/conventions]
created: 2026-06-17
summary: Frontmatter schema and tag/type vocabulary that make notes searchable via the obsidian-notes MCP.
keywords: [frontmatter, metadata, schema, taxonomy, dataview, search, conventions]
aliases: [metadata schema, note conventions]
---

# Vault Conventions

These conventions make notes findable through the `obsidian-notes` MCP, whose search is
**keyword + structured field queries** (`search_simple` full-text, `search_query` via
Dataview DQL / JsonLogic over frontmatter) — not semantic. Consistent metadata is what
makes that work.

## Frontmatter schema

Every note should carry a YAML frontmatter block. Fields:

| Field | Required | Purpose |
|---|---|---|
| `title` | yes | Human title (independent of filename). |
| `type` | yes | Note kind — controlled vocabulary below. |
| `status` | for living notes | `draft` \| `active` \| `done` \| `archived`. |
| `tags` | yes | List, hierarchical — controlled vocabulary below. |
| `project` | when applicable | Initiative, e.g. `june`. |
| `area` | optional | Broad domain, e.g. `infra`, `devops`, `research`. |
| `created` | yes | `YYYY-MM-DD` (absolute, never relative). |
| `modified` | optional | `YYYY-MM-DD` of last meaningful edit. |
| `summary` | yes | One-line plain description. Highest-value field for search. |
| `keywords` | recommended | Synonyms/jargon/abbreviations — the way to make keyword search approximate semantic search. |
| `aliases` | optional | Alternate names the note should be findable under. |
| `people` | optional | Names involved. |
| `source` | optional | URL or origin (never a credentialed URL). |

## `type` vocabulary (controlled)

`engineering-log` · `reference` · `decision` · `meeting` · `idea` · `task` · `daily` · `project`

Pick exactly one. Add nuance with tags, not new `type` values.

## Tag taxonomy (hierarchical, controlled)

Use `namespace/value`, lowercase, kebab-case. Keep the set small and reuse it.

- `area/*` — `area/infra`, `area/devops`, `area/research`, `area/product`
- `project/*` — `project/june`
- `tech/*` — `tech/wsl`, `tech/obsidian`, `tech/mcp`, `tech/networking`
- `meta/*` — `meta/conventions`, `meta/template`

Inconsistent ad-hoc tags are the #1 thing that breaks search — prefer an existing tag over
inventing a near-duplicate.

## Body conventions

- **Descriptive `##` headings** so `vault_get_document_map` can target a section (Claude
  reads one block instead of the whole note).
- **Block IDs** (`^some-id`) on lines worth addressing directly.
- **`[[wikilinks]]`** between related notes to build a navigable graph.
- Inline Dataview fields (`status:: active`) when a value belongs next to a body line.

## Secrets

Never put API keys, tokens, `.env` values, or credentialed URLs in a note. Refer to
services generically.
