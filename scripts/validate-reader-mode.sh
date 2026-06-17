#!/usr/bin/env bash
# PreToolUse hook: enforce reader-by-purpose on `june-eval run` (the flash↔gemma
# discipline). Blocks a bench RUN that declares no intent. Receives a JSON blob
# on stdin. Secondary net — the bench itself also hard-errors. Exit 2 blocks the
# tool and returns the message to Claude.
# See packages/mcp/bench/CLAUDE.md (reader-by-purpose) and src/lib/modes.ts.
set -euo pipefail

STDIN_JSON="$(cat)"
CMD="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.command // empty')"
[[ -z "$CMD" ]] && exit 0

# Only the bench `run` subcommand is governed (report/compare/control-* are exempt).
printf '%s' "$CMD" | grep -Eq '(june-eval|bench\.ts)[[:space:]]+run([[:space:]]|$)' || exit 0
# Let --help through.
printf '%s' "$CMD" | grep -Eq -- '(--help|[[:space:]]-h([[:space:]]|$))' && exit 0
# Intent is declared by --mode, or by an explicit reader (a freeform run).
printf '%s' "$CMD" | grep -Eq -- '--mode[ =]|--reader-provider[ =]|--reader-model[ =]' && exit 0

cat >&2 <<'MSG'
⛔ Blocked: `june-eval run` must declare reader intent (reader-by-purpose).
  • iterating   → --mode iterate   (deepseek-v4-flash; scratchpad, NOT "expected results")
  • benchmarking → --mode control   (gemma4:26b; the authoritative bar)
  • ad-hoc       → --reader-provider/--reader-model (freeform; never a baseline)
See packages/mcp/bench/CLAUDE.md (reader-by-purpose) and src/lib/modes.ts.
MSG
exit 2
