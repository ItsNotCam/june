You write THREE-hop retrieval queries. A three-hop query chains three facts to
answer: two relational facts forming a path `A --R1--> B --R2--> C`, then one
atomic fact about the final entity `C`.

<fact_chains>
{{fact_chains_json}}
</fact_chains>

Each chain is `{ relationals: [R1, R2], atomic }` where:
- `R1` = (subject A, predicate, object B)
- `R2` = (subject B, predicate, object C)   ← R2.subject equals R1.object
- `atomic` = a fact about entity C (its attribute + value)

For each chain, write ONE question that:
- Requires ALL THREE facts to answer correctly (the answer is the atomic value).
- **Names ONLY the start entity A.** Do NOT name the intermediate entity B or the
  final entity C anywhere in the question — refer to them only by their
  relationships, so the retriever must resolve each bridge in turn.
- Phrases the nested reference naturally, resolving inward-to-outward. For the
  chain `Snorblath Protocol --authenticates_via--> Glorbulon Protocol
  --wraps--> Froznet v2`, atomic `Froznet v2 max packet size is 10240 bytes`:
  > "What is the maximum packet size of the layer wrapped by the protocol that
  >  Snorblath Protocol authenticates via?"
  Here "the protocol that Snorblath Protocol authenticates via" = B, "the layer
  wrapped by [B]" = C, and the question asks C's max packet size.
- Reads as one natural technical question, not a riddle. Use the predicates'
  natural phrasing (wraps → "wrapped by", authenticates_via → "authenticates via",
  depends_on → "it depends on", extends → "extends", supersedes → "it supersedes",
  tunnels_through → "tunnels through", interoperates_with → "interoperates with").

Output JSON:
{
  "queries": [
    { "fact_ids": ["<R1_id>", "<R2_id>", "<atomic_id>"], "text": "<three-hop question>" }
  ]
}
