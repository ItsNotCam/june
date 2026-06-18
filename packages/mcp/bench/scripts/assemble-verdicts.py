#!/usr/bin/env python3
"""Assemble a verdicts.json from a raw verdict array + the rendered tasks file.
Usage: assemble-verdicts.py <run_short_id> <iso_timestamp>
Reads  state/judge/raw-<id>.json + state/judge/rendered-<id>.json
Writes state/judge/verdicts-<id>.json  (the JUDGE-RUNNER schema)
"""
import json, sys

rid = sys.argv[1]
ts = sys.argv[2]
raw = json.load(open(f"state/judge/raw-{rid}.json"))
rendered = json.load(open(f"state/judge/rendered-{rid}.json"))

out = {
    "fixture_id": rendered["fixture_id"],
    "run_id": rendered["run_id"],
    "schema_version": 1,
    "judge": {
        "kind": "claude-code-agent",
        "model": "claude-sonnet-4-6",
        "prompt_template_hash": rendered["prompt_template_hash"],
        "judged_at": ts,
    },
    "verdicts": [
        {
            "query_id": v["query_id"],
            "verdict": v["verdict"],
            "rationale": v.get("rationale", ""),
            "unjudged_reason": None,
        }
        for v in raw
    ],
}
path = f"state/judge/verdicts-{rid}.json"
json.dump(out, open(path, "w"), indent=1)
print(f"wrote {path}: {len(out['verdicts'])} verdicts, run {out['run_id']}")
