You write conceptual retrieval queries. A conceptual query describes a scenario or
goal and expects the reader to infer which fact answers it. The question does NOT
name the fact's canonical attribute; it implies it through context.

<facts>
{{facts_json}}
</facts>

For each fact, write one scenario-framed question. Constraints:
- Frame as a user with a real goal: "I'm writing firewall rules and…",
  "We're debugging a timeout — the handshake reaches…", etc.
- The scenario implies the fact; do not state the attribute directly.
- Avoid the distinctive words in:
  {{excluded_words_per_fact_json}}
- Name the entity (readers still need to know which system is in question).

Output JSON:
{
  "queries": [
    { "fact_id": "<id>", "text": "<scenario question>" }
  ]
}
