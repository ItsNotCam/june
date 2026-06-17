import { Database } from "bun:sqlite";
import { AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers";
import { readFileSync } from "node:fs";

const DB = process.argv[2]!;
const QID = process.argv[3]!;
const db = new Database(DB, { readonly: true });
const stmt = db.query<{ raw_content: string }, [string]>("SELECT raw_content FROM chunks WHERE chunk_id = ?");
const text = (c: string) => stmt.get(c)?.raw_content ?? null;

const queries = JSON.parse(readFileSync("state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG/queries.json", "utf8")).queries;
const gt = JSON.parse(readFileSync("state/runs/20260615020227-HZ8P069Z/ground_truth.json", "utf8"));
const f2c: Record<string,string> = {};
for (const r of gt.resolutions) f2c[r.fact_id] = r.chunk_id;
const cand = JSON.parse(readFileSync("state/runs/20260615020817-6TN8JSC9/retrieval_results.json", "utf8"));
const rec = cand.results.find((r: any) => r.query_id === QID);
const q = queries.find((r: any) => r.id === QID);
const answerChunks = q.expected_fact_ids.map((f: string) => f2c[f]).filter(Boolean);

// candidate top-10 ids + the answer chunk (dedup)
const ids: string[] = Array.from(new Set([...rec.retrieved.map((h: any) => h.chunk_id), ...answerChunks]));
const tok = await AutoTokenizer.from_pretrained("Xenova/bge-reranker-base");
const model = await AutoModelForSequenceClassification.from_pretrained("Xenova/bge-reranker-base");
const texts = ids.map((id) => text(id) ?? "");
const inputs = await tok(texts.map(() => q.text), { text_pair: texts, padding: true, truncation: true });
const out = await model(inputs);
const scores = Array.from(out.logits.data as Float32Array, Number);
const ranked = ids.map((id, i) => ({ id, score: scores[i]!, isAnswer: answerChunks.includes(id) }))
  .sort((a, b) => b.score - a.score);
console.log(`Q (${q.tier}): ${q.text}\n`);
ranked.forEach((r, i) => {
  const head = (text(r.id) ?? "").replace(/\n/g, " ").slice(0, 90);
  console.log(`  #${i+1} score=${r.score.toFixed(3)} ${r.isAnswer ? "<<< ANSWER " : "           "} ${head}`);
});
