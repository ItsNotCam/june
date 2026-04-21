// author: Claude
/** One reader answer recorded during Stage 7 (§21). */
export type ReaderAnswer = {
  query_id: string;
  answer_text: string;
  retrieved_chunk_ids: string[];
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

/** On-disk shape of `reader_answers.json`. */
export type ReaderAnswersFile = {
  fixture_id: string;
  reader: { provider: string; model: string; temperature: number };
  answers: ReaderAnswer[];
};

/** On-disk shape of `baseline_answers.json` — the optional no-RAG Opus sibling pass (§23). */
export type BaselineAnswersFile = {
  fixture_id: string;
  baseline: { provider: string; model: string; temperature: number };
  answers: ReaderAnswer[];
};
