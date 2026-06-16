# Transfer log — flash (iterate) prediction vs gemma4:26b (control) verdict

Each milestone gate records what the flash scratchpad *predicted* vs what the gemma
control run *actually* did, by **failure class** (not raw query IDs). Over time this
calibrates how much to trust the flash proxy — the point of the two-reader workflow.

Flash and gemma fail on different queries, so a change is judged by whether it moves a
failure *class* in the same direction on both — never by literal output equality. A
change that helps flash but regresses gemma on `control-check` is **overfit → rejected**.

See `src/lib/modes.ts` and `packages/mcp/bench/CLAUDE.md` (reader-by-purpose).

| Date | Change | Target failure class | Flash (iterate) Δ | Gemma (control) Δ | Transferred? | Verdict |
|---|---|---|---|---|---|---|
| 2026-06-15 | multi-hop bridge lookup `base.slice(0,3)` → `base.slice(0,windowK=5)` (`src/retriever/multi-hop.ts`) | `multi-hop-composition` / wrong-bridge (relational chunk at base rank 4 invisible to a top-3 lookup → bridge resolved to the question's own subject; q-0145 "the layer that Dargwave wraps") | T4 recall@5 92.5→95.0 (+2.5, 37→38/40); T4 correct% 85.0→87.5 (+2.5). T1–T3 flat (recall & correct%). | T4 recall@5 95.0, T4 correct% **95.0** (=recall; reference reader composes all 38 retrieved). T1 100 / T2 96 / T3 97.5 — no regression. (No gemma mh-ON+old-lookup arm; flash A/B isolates the retrieval delta, gemma certifies no correct% regression + composition.) | **Yes** — recall delta is reader-invariant; gemma confirms the recovered chunk is read correctly and nothing regressed. | **Ship.** Single-variable, mechanism-justified (resolve bridge from the reader window the relational chunk reliably occupies). Diagnosed via new `scripts/triage-t4.ts`. Residual T4: q-0176 (extract-bridge picked a prominent wrong entity → `prompts/extract-bridge.md`), q-0151 (atomic at sub-query rank 4/5, `INJECT_SLOTS=1` → injection lever). |
