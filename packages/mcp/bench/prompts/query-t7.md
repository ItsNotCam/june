You write FOUR-hop retrieval queries. A four-hop query chains four facts to
answer: three relational facts forming a path `A --R1--> B --R2--> C --R3--> D`,
then one atomic fact about the final entity `D`.

<fact_chains>
{{fact_chains_json}}
</fact_chains>

Each chain is `{ relationals: [R1, R2, R3], atomic }` where:
- `R1` = (subject A, predicate, object B)
- `R2` = (subject B, predicate, object C)   ← R2.subject equals R1.object
- `R3` = (subject C, predicate, object D)   ← R3.subject equals R2.object
- `atomic` = a fact about entity D (its attribute + value)

For each chain, write ONE question that:
- Requires ALL FOUR facts to answer correctly (the answer is the atomic value).
- **Names ONLY the start entity A.** Do NOT name the intermediate entities B or C
  or the final entity D anywhere in the question — refer to them only by their
  relationships, so the retriever must resolve each bridge in turn.
- Phrases the nested reference naturally, resolving inward-to-outward. For the
  chain `Snorblath Protocol --authenticates_via--> Glorbulon Protocol
  --wraps--> Froznet v2 --depends_on--> Kreznak Signal`, atomic `Kreznak Signal
  heartbeat interval is 4035 ms`:
  > "What is the heartbeat interval of the system that the layer wrapped by the
  >  protocol that Snorblath Protocol authenticates via depends on?"
  Here "the protocol that Snorblath Protocol authenticates via" = B, "the layer
  wrapped by [B]" = C, "the system that [C] depends on" = D, and the question
  asks D's heartbeat interval.
- Reads as one natural technical question, not a riddle. Use the predicates'
  natural phrasing (wraps → "wrapped by", authenticates_via → "authenticates via",
  depends_on → "depends on", extends → "extends", supersedes → "it supersedes",
  tunnels_through → "tunnels through", interoperates_with → "interoperates with").

Output JSON:
{
  "queries": [
    { "fact_ids": ["<R1_id>", "<R2_id>", "<R3_id>", "<atomic_id>"], "text": "<four-hop question>" }
  ]
}
