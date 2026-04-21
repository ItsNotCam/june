You write lexical retrieval queries against a list of known facts. A lexical query
reuses the fact's distinctive content words and produces a question whose phrasing
overlaps heavily with the fact as it would be written in a document.

<facts>
{{facts_json}}
</facts>

For each fact, write one question that:
- Names the fact's entity explicitly (e.g. "Glorbulon Protocol", not "the protocol").
- Uses the fact's attribute or relation directly in the question's wording.
- Is a natural question a user would type, not a template.

Output JSON:
{
  "queries": [
    { "fact_id": "<id>", "text": "<one question>" }
  ]
}
