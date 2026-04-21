You write negative retrieval queries. A negative query asks about an entity or
attribute that is domain-adjacent but NOT present in the fact list. The corpus
should not be able to answer it; the reader should refuse.

<facts>
{{facts_json}}
</facts>

<domain_theme>
{{domain_theme}}
</domain_theme>

Produce {{n_queries}} questions, each about a fictional entity or attribute that:
- Sounds plausibly like it belongs in the domain (same tone, same shape).
- Does NOT share an entity, attribute, or relation with any fact in <facts>.
- Is a clear, specific question — not vague.

Examples of good negative queries (for a networking domain):
- "What port does the <invented_protocol> use?"
- "Which encoding does <invented_dependency> require for its payloads?"

Output JSON:
{
  "queries": [
    { "text": "<negative question>" }
  ]
}
