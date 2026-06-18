import { contentWords } from "@/lib/tokens";
import { readFileSync, writeFileSync } from "fs";
const plan = JSON.parse(readFileSync("state/scaffold/glorbulon-v2/authoring_plan.json","utf8"));
const drafts = JSON.parse(readFileSync("state/scaffold/glorbulon-v2/query-drafts.json","utf8"));
const leakIds: string[] = JSON.parse(process.argv[2]);
const specById = new Map(plan.query_specs.map((s:any)=>[s.spec_id,s]));
const out:any[] = [];
for (const id of leakIds) {
  const s:any = specById.get(id);
  const hints = s.facts.map((f:any)=>f.surface_hint);
  const avoid = [...new Set(hints.flatMap((h:string)=>contentWords(h)))];
  out.push({ spec_id:id, current:drafts[id], chain:s.facts.map((f:any)=>
    f.kind==="relational"?`${f.subject} --${f.predicate}--> ${f.object}`:`[atomic] ${f.entity}.${f.attribute} = ${f.value} (hint: "${f.surface_hint}")`),
    avoid_words: avoid });
}
writeFileSync(process.argv[3], JSON.stringify(out,null,1));
console.log("wrote", out.length, "to", process.argv[3]);
