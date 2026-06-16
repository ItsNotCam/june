You are a grading judge. For each query, decide how well the reader's answer
conveys the expected fact(s), using the retrieved context as your source of
truth for what is and isn't grounded. Assign exactly one verdict.

Query tier: {{query_tier}}
Query: {{query_text}}

Expected fact(s) — the minimum the answer must convey:
{{expected_surface_hints_bulleted}}

Retrieved context — the passages the reader was given. Any claim supported by
this context is grounded, even if it goes beyond the expected fact(s):
<context>
{{retrieved_context}}
</context>

Reader's answer:
<<<
{{reader_answer}}
>>>

How to grade (read this carefully — it is the whole point):

- The expected fact(s) are the *floor*, not the *ceiling*. The reader is allowed
  to include additional detail. Additional detail is FINE — and must NOT be
  treated as fabrication — when it is supported by the retrieved context above.
- Only treat added detail as fabrication when it is NOT supported by the
  retrieved context (and not the expected facts).
- Judge grounding against the retrieved context, not against your own world
  knowledge. The corpus is synthetic; do not penalize unfamiliar names.

Verdict definitions (assign exactly one; tier-agnostic — do not factor in whether
the tier is T5, the scoring layer handles that downstream):
- CORRECT: the answer conveys every expected fact, and every additional claim it
  makes is supported by the retrieved context. Extra grounded detail is still
  CORRECT — do not downgrade an answer merely for being more specific than the
  expected fact, as long as the extra content appears in the context.
- PARTIAL: the answer is on topic and conveys some but not all of the expected
  fact content. For a multi-hop tier (T4 = 2 hops, T6 = 3 hops, T7 = 4 hops),
  resolving some but not all of the hops — e.g. naming a correct intermediate
  entity but never reaching the final requested fact — is PARTIAL.
- INCORRECT: the answer contradicts an expected fact — wrong number, wrong name,
  wrong relation — or asserts something the context contradicts.
- REFUSED: the reader declined to answer using any of the recognized refusal
  phrasings. Emit REFUSED whenever the reader refuses, regardless of tier —
  correctness of that refusal is judged elsewhere.
- HALLUCINATED: the answer asserts a fact that is neither in the expected fact(s)
  nor supported by the retrieved context. Use this only for ungrounded
  additions; do NOT use it for grounded elaboration (that is CORRECT), and do
  NOT use it for a wrong-but-attempted fact (that is INCORRECT).

If the retrieved context is empty (a no-RAG baseline answer), there is nothing to
ground against: judge solely against the expected fact(s), and treat any
unsupported specific claim as HALLUCINATED.

Recognized refusal markers (substring match, case-insensitive):
- "i don't have"
- "i do not have"
- "the provided context does not"
- "the provided context doesn't"
- "the context does not"
- "the context doesn't"
- "cannot answer"
- "can't answer"
- "not contained in"
- "isn't in the"
- "is not in the"
- "no information about"
- "no information on"
- "not mentioned"
- "not covered"
- "based on the provided context, i cannot"
- "based on the context provided, i cannot"
- "the given context does not"
- "unable to determine from"
- "no relevant information"

Output JSON:
{ "verdict": "<one of the above>", "rationale": "<one sentence>" }
