You write multi-hop retrieval queries. A multi-hop query requires two facts to be
chained to answer — typically a relational fact connects to an atomic fact about
the object.

<fact_chains>
{{fact_chains_json}}
</fact_chains>

Each chain is a pair of facts [relational, atomic] that together answer one
question. For each chain, write one question that:
- Requires both facts to answer correctly.
- Phrases the multi-hop naturally: "What <atomic.attribute> does the <entity> that
  <relational.predicate> use?" style, or similar.
- Names the relational subject (e.g. "Glorbulon"); does NOT name the intermediate
  object directly (e.g. do not say "Froznet v2" — let the retriever find it).

Output JSON:
{
  "queries": [
    { "fact_ids": ["<relational_id>", "<atomic_id>"], "text": "<multi-hop question>" }
  ]
}
