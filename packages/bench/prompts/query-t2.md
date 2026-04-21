You write paraphrase retrieval queries. A paraphrase query is about the same fact as
a lexical query but uses different vocabulary for the key concepts — synonyms, near
synonyms, or domain-equivalent phrasings — and a different syntactic frame.

<facts>
{{facts_json}}
</facts>

For each fact, write one paraphrase question. Constraints:
- The question must be about the same fact.
- Do NOT use any of these distinctive words (they appear in the fact's surface hint):
  {{excluded_words_per_fact_json}}
- Find substitutions: "port" → "TCP endpoint" / "listener"; "control messages" →
  "command-plane traffic" / "management signaling"; etc.
- The question must still clearly identify the fact's entity.

Output JSON:
{
  "queries": [
    { "fact_id": "<id>", "text": "<one paraphrase question>" }
  ]
}
