#!/usr/bin/env bash
# PostToolUse hook: record Claude's file contributions after Write/Edit.
# Receives a JSON blob on stdin describing the tool invocation.
# Appends one JSONL record to .claude/scratch/authorship.jsonl.
set -euo pipefail

STDIN_JSON="$(cat)"
FILE_PATH="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.file_path // empty')"
TOOL_NAME="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_name // "Write"')"

[[ -z "$FILE_PATH" ]] && exit 0
FILE_PATH="$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")"
[[ ! -f "$FILE_PATH" ]] && exit 0

# Find the git repo root for the file being edited (handles worktrees correctly)
FILE_REPO_ROOT="$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# The log always lives in the main (non-worktree) repo's .claude/scratch/.
# git --git-common-dir points to the shared .git dir for both main and worktrees.
GIT_COMMON_DIR="$(git -C "$FILE_REPO_ROOT" rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$GIT_COMMON_DIR" in
  /*) ;; # already absolute
  *)  GIT_COMMON_DIR="${FILE_REPO_ROOT}/${GIT_COMMON_DIR}" ;;
esac
MAIN_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
LOG_DIR="${MAIN_REPO_ROOT}/.claude/scratch"
LOG_FILE="${LOG_DIR}/authorship.jsonl"

# Relative path from the file's own repo root (same relative path in worktree as in main)
REL_PATH="${FILE_PATH#${FILE_REPO_ROOT}/}"

# Skip binary files
DIFF_OUTPUT="$(git -C "$FILE_REPO_ROOT" diff HEAD -- "$REL_PATH" 2>/dev/null)"
printf '%s' "$DIFF_OUTPUT" | grep -q '^Binary files' && exit 0

# Total lines in file (trim whitespace — wc -l pads with spaces on some systems)
TOTAL_LINES="$(wc -l < "$FILE_PATH" | tr -d '[:space:]')"
# wc -l misses final line if file has no trailing newline — guard for non-empty files
[[ "$TOTAL_LINES" -eq 0 && -s "$FILE_PATH" ]] && TOTAL_LINES=1

# Determine Claude-added lines
PORCELAIN="$(git -C "$FILE_REPO_ROOT" status --porcelain "$REL_PATH" 2>/dev/null)"
if printf '%s' "$PORCELAIN" | grep -q '^??'; then
  # Untracked new file: all lines are Claude's
  CLAUDE_ADDS="$TOTAL_LINES"
else
  # Tracked file: count + lines in diff (exclude +++ header); trim whitespace for jq
  # Use plain '^+++' not '^\+\+\+' — in BRE, \+ is a GNU quantifier extension
  CLAUDE_ADDS="$(printf '%s' "$DIFF_OUTPUT" | grep '^+' | grep -v '^+++' | wc -l | tr -d '[:space:]')"
fi

# ── Flip // author: comment if Claude crosses the 50% threshold ──────────────
if [[ "$TOTAL_LINES" -gt 0 ]] && grep -q "^// author: " "$FILE_PATH" 2>/dev/null; then
  PCT_INT="$(awk "BEGIN { printf \"%d\", ($CLAUDE_ADDS / $TOTAL_LINES) * 100 }")"
  if [[ "$PCT_INT" -gt 50 ]]; then
    sed -i "s|^// author: .*$|// author: Claude|" "$FILE_PATH"
  fi
fi

mkdir -p "$LOG_DIR"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RECORD="$(jq -cn \
  --arg ts    "$TIMESTAMP" \
  --arg file  "$REL_PATH" \
  --arg tool  "$TOOL_NAME" \
  --argjson claude_adds "$CLAUDE_ADDS" \
  --argjson total       "$TOTAL_LINES" \
  '{ts:$ts, file:$file, tool:$tool, claude_adds:$claude_adds, total:$total}')"

# flock prevents torn writes if hook fires in parallel
(flock -x 200; printf '%s\n' "$RECORD" >> "$LOG_FILE") 200>"${LOG_DIR}/.authorship.lock"
