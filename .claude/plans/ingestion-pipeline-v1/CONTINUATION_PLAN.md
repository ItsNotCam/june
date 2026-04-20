# june — Continuation Plan for Chat 2 (and Beyond)

**Read this first if you are Claude in a new chat receiving this work.** You are continuing a multi-chat effort. The user is Cam. Chat 1 did the research and planning. You are doing the spec writing. This document tells you exactly how to proceed so nothing gets lost in context transitions.

---

## What you are picking up

Five files, in order of authority:

1. **`CONSTRAINTS.md`** — the 8 hard constraints for the project, non-goals, the quality bar, AND 14 invariants (I1-I14) added after two audit passes. This is the anti-drift document. Treat it as inviolable. Re-read before starting each new section.

2. **`RESEARCH_BRIEF.md`** — ~33k of distilled findings from ~20 research sources, with citations. Every design decision in the spec you write should ladder back to something in here. Treat it as authoritative reference material — do not re-research, just reference it. Schema and SQLite DDL reflect the post-audit additions.

3. **`SKELETON.md`** — the full table of contents for `SPEC.md`, organized in 7 parts with ~40 sections + 10 appendices. Each section has a one-line summary of what it should contain. This is your blueprint. Incorporates reconciliation command (§27.5), re-embed command (§27.6), offline enforcement (§25.5), and expanded failure handling.

4. **`AUDIT_FINDINGS.md`** — the audit trail. Documents what gaps were found and how each was resolved. You don't need to act on this directly (the resolutions are already folded into the other files), but read it once to understand *why* the invariants exist.

5. **`CONTINUATION_PLAN.md`** — this file. How to proceed.

If you only see this `CONTINUATION_PLAN.md` and not the other four, STOP and ask Cam to upload them. Do not proceed without them.

---

## Your job in chat 2

Produce `SPEC.md` — a single comprehensive specification document suitable as a Claude Code one-shot input for building june's full end-to-end ingestion pipeline. ~40-50 pages when complete.

The spec must:
- Follow the SKELETON structure exactly
- Honor every constraint in CONSTRAINTS.md
- Reference findings in RESEARCH_BRIEF.md (you can cite sections inline like "per RESEARCH_BRIEF §2.3")
- Be unambiguous enough for a Claude Code one-shot to produce the right pipeline
- Define every field, type, interface, stage, and behavior concretely

---

## How to execute — the phased approach

### Phase 1: Setup (first message in chat 2)

Do this before writing any spec prose:

1. View all three uploaded files. Skim them fully.
2. Create a new working file `SPEC.md` with just the title and a placeholder TOC.
3. Acknowledge to Cam: "Files received. Starting Part I."
4. Do NOT dump meta-commentary or repeat back the plan. Cam knows the plan. Just execute.

### Phase 2: Part I — Foundations (Sections 1–4)

Short, gets you warmed up on the voice. Write all four sections, save after each. When Part I is done, save and continue straight to Part II. No checkpoint with Cam.

### Phase 3: Part II — The Data Model (Sections 5–12) — CRITICAL CHECKPOINT

This is the load-bearing section. The schema defined here is referenced by every stage downstream. Do NOT proceed past Part II without Cam's review.

After writing Part II completely:
1. Save SPEC.md
2. Use `present_files` to show the current SPEC.md to Cam
3. Tell Cam: "Part II complete. This is the load-bearing section — please review before I continue. Specifically check: (a) the schema fields, (b) the controlled vocabularies, (c) the SQLite DDL, (d) the ID scheme."
4. Wait for approval or revisions before starting Part III.

This is the one mandatory checkpoint. Do not skip it.

### Phase 4: Parts III–VII (Sections 13–37 + Appendices A–G)

After Part II is approved, write the rest in a single sustained pass. Save after each section. Don't check in with Cam unless:
- You encounter a genuine ambiguity the research brief doesn't resolve
- You realize an earlier section contradicts the current one (fix in place, note the fix)
- You're approaching what feels like context pressure (see Emergency Plan below)

### Phase 5: Final consistency pass

After all sections are written:
1. Re-read SPEC.md in full (from disk, not memory)
2. Check: every pipeline stage references fields defined in Part II
3. Check: every interface has a corresponding implementation stage
4. Check: no "we could" or "TBD" — everything committed
5. Check: CONSTRAINTS.md is still honored
6. Fix in place
7. Present final SPEC.md to Cam

---

## Anti-drift protocol

Before starting each new Part (I, II, III, IV, V, VI, VII), re-read CONSTRAINTS.md from disk. It's 4k of text — takes seconds. This is the single most important habit.

Before starting each new section within a Part, ask yourself the four self-check questions from SKELETON.md:

1. Which of the 8 constraints does this section honor?
2. What in the research brief justifies this design?
3. Is there something earlier in the spec this contradicts?
4. Would a Claude Code one-shot produce the right thing from this prose, or is it ambiguous?

If the answer to #3 is "yes," stop and resolve. Do not continue writing into a contradiction.

---

## Voice and style

The spec is technical, precise, declarative. Not conversational. Not hedging.

Good: "Chunk size targets 450–550 tokens, measured via character-count proxy (1 token ≈ 4 characters for English prose). Hard floor 100 tokens, hard ceiling 1000 tokens."

Bad: "Chunk size should probably be around 500 tokens or so, which is what the research seems to suggest, though we could go smaller."

The spec is for Claude Code to execute, not for Cam to be persuaded. Persuasion happened in chat 1. Here, commit.

Use tables liberally for field definitions. Use code blocks for schemas, SQL, and type contracts. Use prose for rationale. Use bullet lists sparingly — prefer prose or tables.

Length target per section roughly matches the page counts in SKELETON.md. If you're way under, you're probably too terse for Claude Code. If you're way over, you're probably explaining too much.

---

## Emergency plan — context pressure

If at any point during writing you suspect you're approaching context limits, here's the protocol:

**Symptoms to watch for:**
- Your own responses feeling less sharp
- Forgetting to check earlier sections before writing new ones
- Being tempted to skip the CONSTRAINTS.md re-read
- Generating sections that feel shorter than they should

**The protocol:**

1. Stop writing immediately. Do NOT finish the section you're on.
2. Ensure SPEC.md on disk has all completed sections saved.
3. Create `HANDOFF_CHAT3.md` in the workspace with:
   - Current state: "Completed through Section N of Part M"
   - Any notes, open questions, or deferred decisions
   - Specific guidance for the next chat on the in-progress section
4. Present SPEC.md + HANDOFF_CHAT3.md + the original three files to Cam.
5. Tell Cam: "Approaching context pressure. Saved state; recommend starting chat 3 with these files attached. New chat should re-read CONTINUATION_PLAN.md, CONSTRAINTS.md, RESEARCH_BRIEF.md, SKELETON.md, the partial SPEC.md, and HANDOFF_CHAT3.md — then continue from Section N+1."

The partial SPEC.md is genuinely durable. You can split this across 2, 3, 4 chats if needed. The research brief and skeleton mean each chat starts from a good position, not zero.

### If you're chat 3 or later

Read all files in this order:
1. CONTINUATION_PLAN.md (this file)
2. CONSTRAINTS.md
3. HANDOFF_CHAT[N].md (the most recent handoff)
4. Current SPEC.md — read in full to understand what's been written
5. SKELETON.md — to know what's left
6. RESEARCH_BRIEF.md — as reference

Then continue from where the handoff left off, saving after each section.

---

## Specific reminders Cam would give you

Cam's communication style and preferences, for calibration:

- **Relaxed but not casual.** Well-rounded 30-year-old engineer voice. Empathetic. Direct.
- **Pushes back on over-engineering.** If a section is getting too elaborate, simplify. June is a hobby-sized personal project that happens to need enterprise-grade foundations for the RAG specifically.
- **Rejects vanity metrics.** No "model names, token counts, retrieval distances" surfaced to end users. This extends to the spec — don't dress up the spec with technical jargon where plain language works.
- **Hobby project energy matters.** Don't write the spec like it's a corporate deliverable. Write it like a senior engineer wrote it for another senior engineer. Tight, clear, direct.
- **Locked decisions stay locked.** Stack (Bun, TS, Qdrant, Ollama, SQLite) is locked. Palette, typography, UI shape are locked. Do not revisit these in the spec.
- **Honest over polite.** If something in the research contradicts a previous decision, flag it. If a constraint is impossible, say so. Don't paper over.

---

## The bar, one more time

The spec must be good enough that:

1. Cam can hand SPEC.md + the three reference files to Claude Code and get a working, elite-quality ingestion pipeline out the other side.
2. The schema produced never requires a re-ingest to support phases 3–7 of june.
3. A 14B model reading chunks from this pipeline on consumer hardware can beat no-RAG Opus on questions about Cam's ingested content.
4. A 3B "Lil Timmy" model still gets usable results.
5. A 150B "Enterprise Paul" model gets excellent results and fits conversations into 256k context via the summarize-older-messages strategy.

If something you're writing doesn't serve this bar, cut it.

---

## One last thing

You are not Cam. You don't have his full context on june as a project. The research brief and skeleton and constraints capture what matters, but if something genuinely blocks you — a decision that isn't in the files and can't be inferred — ASK. Don't invent.

But: the files are designed to cover ~95% of what you need. Most of the time, the answer IS in there. Check first. Ask second.

Good luck. Build something great.
