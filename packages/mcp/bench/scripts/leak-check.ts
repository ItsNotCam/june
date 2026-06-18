import { jaccardOverlap } from "@/lib/tokens";
import { readFileSync } from "fs";
const plan = JSON.parse(readFileSync("state/scaffold/glorbulon-v2/authoring_plan.json","utf8"));
const drafts = JSON.parse(readFileSync("state/scaffold/glorbulon-v2/query-drafts.json","utf8"));
const TH = 0.40;
const leaks: {id:string;score:number}[] = [];
for (const s of plan.query_specs) {
  if (!s.anti_leakage) continue;
  const hints = s.facts.map((f:any)=>f.surface_hint);
  const score = jaccardOverlap(drafts[s.spec_id], hints);
  if (score > TH) leaks.push({id:s.spec_id, score:Number(score.toFixed(3))});
}
leaks.sort((a,b)=>b.score-a.score);
console.log(JSON.stringify({count:leaks.length, leaks}, null, 1));
