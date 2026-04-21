#!/usr/bin/env bash
# Authorship check: run before writing any commit message.
# Reads staged files, looks up latest tracking entry per file, and prints
# a table plus two explicit lists: claude-primary and cam-primary.
set -euo pipefail

# Resolve to current git repo root (works in both main tree and worktrees)
REPO_ROOT="$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repo" >&2; exit 1
}

# The log always lives in the main (non-worktree) repo's .claude/scratch/.
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null)" || {
  echo "ERROR: could not resolve git common dir" >&2; exit 1
}
case "$GIT_COMMON_DIR" in
  /*) ;; # already absolute
  *)  GIT_COMMON_DIR="${REPO_ROOT}/${GIT_COMMON_DIR}" ;;
esac
MAIN_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
LOG_FILE="${MAIN_REPO_ROOT}/.claude/scratch/authorship.jsonl"

# Staged files with content (exclude deletions)
STAGED_FILES="$(git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=AMRC 2>/dev/null)"

if [[ -z "$STAGED_FILES" ]]; then
  echo "No staged files with content changes."
  exit 0
fi

CLAUDE_FILES=()
CAM_FILES=()

echo ""
printf '%-60s  %8s  %8s  %6s  %s\n' "FILE" "CLAUDE+" "TOTAL" "PCT" "AUTHOR"
printf '%0.s─' {1..100}; echo

while IFS= read -r rel_file; do
  [[ -z "$rel_file" || ! -f "${REPO_ROOT}/${rel_file}" ]] && continue

  LATEST=""
  if [[ -f "$LOG_FILE" ]]; then
    LATEST="$(grep "\"file\":\"${rel_file}\"" "$LOG_FILE" 2>/dev/null | tail -1 || true)"
  fi

  if [[ -z "$LATEST" ]]; then
    printf '%-60s  %8s  %8s  %6s  %s\n' "$rel_file" "?" "?" "?" "cam (no data)"
    CAM_FILES+=("$rel_file")
    continue
  fi

  CLAUDE_ADDS="$(printf '%s' "$LATEST" | jq -r '.claude_adds')"
  TOTAL="$(printf '%s' "$LATEST" | jq -r '.total')"

  if [[ "$TOTAL" -eq 0 ]]; then
    PCT="0.0"; PCT_INT=0
  else
    PCT="$(awk "BEGIN { printf \"%.1f\", ($CLAUDE_ADDS / $TOTAL) * 100 }")"
    PCT_INT="$(awk "BEGIN { printf \"%d\", ($CLAUDE_ADDS / $TOTAL) * 100 }")"
  fi

  if [[ "$PCT_INT" -gt 50 ]]; then
    AUTHOR="claude"
    CLAUDE_FILES+=("$rel_file")
  else
    AUTHOR="cam"
    CAM_FILES+=("$rel_file")
  fi

  printf '%-60s  %8s  %8s  %5s%%  %s\n' "$rel_file" "$CLAUDE_ADDS" "$TOTAL" "$PCT" "$AUTHOR"
done <<< "$STAGED_FILES"

printf '%0.s─' {1..100}; echo
echo ""
echo "CLAUDE-primary (>50%)  — commit these with trailer:"
echo "    Co-authored-by: Claude <claude@anthropic.com>"
for f in "${CLAUDE_FILES[@]:-}"; do [[ -n "$f" ]] && echo "  $f"; done

echo ""
echo "CAM-primary (≥50%)     — commit these without co-author trailer:"
for f in "${CAM_FILES[@]:-}"; do [[ -n "$f" ]] && echo "  $f"; done
echo ""
