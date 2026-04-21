#!/usr/bin/env bash
# Tests for scripts/track-authorship.sh and scripts/check-authorship.sh.
# Creates isolated temporary git repos for each test — no real repo is touched.
# Run from the repo root: bash scripts/__test__/authorship.test.sh
set -uo pipefail   # note: no -e — assertions use manual exit codes

TRACK="$(realpath "$(dirname "$0")/../track-authorship.sh")"
CHECK="$(realpath "$(dirname "$0")/../check-authorship.sh")"

PASS=0; FAIL=0
REPO=""
LOG_FILE=""

# ── counters written to temp file so subshells can share them ──────────────
RESULTS="$(mktemp)"
trap 'rm -f "$RESULTS"; [[ -n "$REPO" ]] && rm -rf "$REPO"' EXIT

bump_pass() { echo "P" >> "$RESULTS"; }
bump_fail() { echo "F" >> "$RESULTS"; }

ok()   { echo "  ✓  $1"; bump_pass; }
fail() { echo "  ✗  $1"; bump_fail; }

assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  [[ "$actual" == "$expected" ]] && ok "$desc" || fail "$desc (got '$actual', want '$expected')"
}
assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  [[ "$haystack" == *"$needle"* ]] && ok "$desc" || fail "$desc (expected to contain '$needle')"
}
assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  [[ "$haystack" != *"$needle"* ]] && ok "$desc" || fail "$desc (expected NOT to contain '$needle')"
}
assert_file_exists() { [[ -f "$2" ]] && ok "$1" || fail "$1 (file not found: $2)"; }
assert_no_file()     { [[ ! -f "$2" ]] && ok "$1" || fail "$1 (file should not exist: $2)"; }

section() { echo ""; echo "── $1"; }

# ── test repo helpers ──────────────────────────────────────────────────────

setup_repo() {
  [[ -n "$REPO" ]] && rm -rf "$REPO"
  REPO="$(mktemp -d)"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email "test@example.com"
  git -C "$REPO" config user.name "Test"
  mkdir -p "$REPO/.claude/scratch"
  LOG_FILE="${REPO}/.claude/scratch/authorship.jsonl"
  # Seed an initial commit so HEAD exists (many scripts require it)
  printf 'seed\n' > "$REPO/_seed.ts"
  git -C "$REPO" add _seed.ts
  git -C "$REPO" commit -q -m "seed"
}

teardown_repo() { rm -rf "$REPO"; REPO=""; LOG_FILE=""; }

payload() {
  local tool="$1" file="$2"
  jq -cn --arg t "$tool" --arg f "$file" \
    '{"hook_event_name":"PostToolUse","tool_name":$t,"tool_input":{"file_path":$f},"tool_response":""}'
}

run_track() {
  local tool="$1" file="$2"
  payload "$tool" "$file" | bash "$TRACK" 2>/dev/null || true
}

latest_log_entry() {
  local rel="$1"
  [[ -f "$LOG_FILE" ]] || { echo "{}"; return; }
  grep "\"file\":\"${rel}\"" "$LOG_FILE" 2>/dev/null | tail -1 || echo "{}"
}

run_check() {
  local repo="${1:-$REPO}"
  (cd "$repo" && bash "$CHECK" 2>/dev/null) || true
}

# ── track-authorship.sh tests ──────────────────────────────────────────────

section "track: ignores non-Write/Edit tools"
setup_repo
payload "Read" "$REPO/_seed.ts" | bash "$TRACK" 2>/dev/null || true
assert_no_file "Read tool → no log created" "$LOG_FILE"
payload "Bash" "$REPO/_seed.ts" | bash "$TRACK" 2>/dev/null || true
assert_no_file "Bash tool → no log created" "$LOG_FILE"
teardown_repo

section "track: skips missing file_path"
setup_repo
jq -cn '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":""},"tool_response":""}' \
  | bash "$TRACK" 2>/dev/null || true
assert_no_file "Empty file_path → no log" "$LOG_FILE"

jq -cn '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/no/such/file.ts"},"tool_response":""}' \
  | bash "$TRACK" 2>/dev/null || true
assert_no_file "Non-existent file → no log" "$LOG_FILE"
teardown_repo

section "track: new untracked file → all lines Claude's"
setup_repo
printf 'line1\nline2\nline3\n' > "$REPO/new.ts"
run_track "Write" "$REPO/new.ts"

assert_file_exists "Log file created" "$LOG_FILE"
ENTRY="$(latest_log_entry "new.ts")"
assert_eq "claude_adds = 3" "$(printf '%s' "$ENTRY" | jq -r '.claude_adds')" "3"
assert_eq "total = 3"       "$(printf '%s' "$ENTRY" | jq -r '.total')"       "3"
assert_eq "file = new.ts"   "$(printf '%s' "$ENTRY" | jq -r '.file')"        "new.ts"
teardown_repo

section "track: tracked modified file → diff lines only"
setup_repo
printf 'l1\nl2\nl3\nl4\nl5\n' > "$REPO/src.ts"
git -C "$REPO" add src.ts && git -C "$REPO" commit -q -m "add src"

printf 'l1\nl2\nl3\nl4\nl5\nnew1\nnew2\n' > "$REPO/src.ts"
run_track "Write" "$REPO/src.ts"

ENTRY="$(latest_log_entry "src.ts")"
assert_eq "claude_adds = 2" "$(printf '%s' "$ENTRY" | jq -r '.claude_adds')" "2"
assert_eq "total = 7"       "$(printf '%s' "$ENTRY" | jq -r '.total')"       "7"
teardown_repo

section "track: edit tool writes correct entry"
setup_repo
printf 'a\nb\nc\n' > "$REPO/x.ts"
git -C "$REPO" add x.ts && git -C "$REPO" commit -q -m "add x"
printf 'a\nb\nc\nD\nE\n' > "$REPO/x.ts"
run_track "Edit" "$REPO/x.ts"

ENTRY="$(latest_log_entry "x.ts")"
assert_eq "tool=Edit"       "$(printf '%s' "$ENTRY" | jq -r '.tool')"        "Edit"
assert_eq "claude_adds = 2" "$(printf '%s' "$ENTRY" | jq -r '.claude_adds')" "2"
teardown_repo

section "track: log entry has all required JSON fields"
setup_repo
printf 'line\n' > "$REPO/f.ts"
git -C "$REPO" add f.ts && git -C "$REPO" commit -q -m "add f"
printf 'line\nextra\n' > "$REPO/f.ts"
run_track "Write" "$REPO/f.ts"

ENTRY="$(latest_log_entry "f.ts")"
for field in ts file tool claude_adds total; do
  VAL="$(printf '%s' "$ENTRY" | jq -r ".${field} // \"MISSING\"")"
  assert_not_contains "field '${field}' present" "$VAL" "MISSING"
done
teardown_repo

section "track: latest entry reflects cumulative diff after multiple writes"
setup_repo
printf 'a\nb\nc\n' > "$REPO/f.ts"
git -C "$REPO" add f.ts && git -C "$REPO" commit -q -m "add f"

# First write: adds 1 line (diff from HEAD = 1)
printf 'a\nb\nc\nd\n' > "$REPO/f.ts"
run_track "Write" "$REPO/f.ts"

# Second write: adds 2 more lines (diff from HEAD now = 3 cumulative)
printf 'a\nb\nc\nd\ne\nf\n' > "$REPO/f.ts"
run_track "Edit" "$REPO/f.ts"

ENTRY="$(latest_log_entry "f.ts")"
assert_eq "latest claude_adds = 3 (cumulative)" "$(printf '%s' "$ENTRY" | jq -r '.claude_adds')" "3"
assert_eq "total = 6"                             "$(printf '%s' "$ENTRY" | jq -r '.total')"       "6"
teardown_repo

# ── check-authorship.sh tests ──────────────────────────────────────────────

section "check: no staged files → clean message"
setup_repo
OUT="$(run_check)"
assert_contains "no staged files message" "$OUT" "No staged files"
teardown_repo

section "check: no log file → all files cam (no data)"
setup_repo
printf 'changed\n' > "$REPO/_seed.ts"
git -C "$REPO" add _seed.ts
OUT="$(run_check)"
assert_contains "shows 'cam (no data)'" "$OUT" "cam (no data)"
# File entries are indented with exactly 2 spaces; grab only those lines in the claude section
CLAUDE_FILES_LISTED="$(printf '%s' "$OUT" | awk '/CLAUDE-primary/,/CAM-primary/' | grep '^  [^ ]' || true)"
assert_eq "no files listed in claude section" "$CLAUDE_FILES_LISTED" ""
teardown_repo

section "check: 100% Claude file → claude-primary"
setup_repo
printf 'line1\nline2\nline3\n' > "$REPO/new.ts"
run_track "Write" "$REPO/new.ts"
git -C "$REPO" add new.ts
OUT="$(run_check)"
assert_contains "new.ts listed"      "$OUT" "new.ts"
assert_contains "author = claude"    "$OUT" "claude"
assert_contains "100% displayed"     "$OUT" "100.0%"
teardown_repo

section "check: 0% Claude → cam-primary"
setup_repo
printf '%0.s-\n' {1..3} > "$REPO/cam.ts"
git -C "$REPO" add cam.ts && git -C "$REPO" commit -q -m "add"
printf '{"ts":"2026-01-01T00:00:00Z","file":"cam.ts","tool":"Write","claude_adds":0,"total":3}\n' > "$LOG_FILE"
printf 'changed\n' > "$REPO/cam.ts"
git -C "$REPO" add cam.ts
OUT="$(run_check)"
assert_contains "author = cam" "$OUT" "cam"
CLAUDE_SECTION="$(printf '%s' "$OUT" | awk '/CLAUDE-primary/,/CAM-primary/' | tail -n +2)"
assert_not_contains "cam.ts not in claude section" "$CLAUDE_SECTION" "cam.ts"
teardown_repo

section "check: boundary — exactly 50% Claude → cam-primary"
setup_repo
printf 'a\nb\n' > "$REPO/bnd.ts"
git -C "$REPO" add bnd.ts && git -C "$REPO" commit -q -m "add"
# 1 claude line / 2 total = 50% → cam (≤50% → cam)
printf '{"ts":"2026-01-01T00:00:00Z","file":"bnd.ts","tool":"Write","claude_adds":1,"total":2}\n' > "$LOG_FILE"
printf 'a\nb\nmodified\n' > "$REPO/bnd.ts"   # must modify so it appears in staged diff
git -C "$REPO" add bnd.ts
OUT="$(run_check)"
CLAUDE_SECTION="$(printf '%s' "$OUT" | awk '/CLAUDE-primary/,/CAM-primary/' | tail -n +3)"
assert_not_contains "50% → cam, not in claude section" "$CLAUDE_SECTION" "bnd.ts"
CAM_SECTION="$(printf '%s' "$OUT" | awk '/CAM-primary/,0' | tail -n +2)"
assert_contains "50% → appears in cam section" "$CAM_SECTION" "bnd.ts"
teardown_repo

section "check: boundary — 51% Claude → claude-primary"
setup_repo
printf '%0.s-\n' {1..100} > "$REPO/f51.ts"
git -C "$REPO" add f51.ts && git -C "$REPO" commit -q -m "add"
# 51/100 = 51% → claude
printf '{"ts":"2026-01-01T00:00:00Z","file":"f51.ts","tool":"Write","claude_adds":51,"total":100}\n' > "$LOG_FILE"
printf 'modified\n' >> "$REPO/f51.ts"   # must modify so it appears in staged diff
git -C "$REPO" add f51.ts
OUT="$(run_check)"
CLAUDE_SECTION="$(printf '%s' "$OUT" | awk '/CLAUDE-primary/,/CAM-primary/' | tail -n +3)"
assert_contains "51% → appears in claude section" "$CLAUDE_SECTION" "f51.ts"
teardown_repo

section "check: mixed split — each file goes to correct group"
setup_repo
printf '%0.s-\n' {1..100} > "$REPO/claude.ts"
printf '%0.s-\n' {1..100} > "$REPO/cam.ts"
git -C "$REPO" add claude.ts cam.ts && git -C "$REPO" commit -q -m "add"

printf '{"ts":"2026-01-01T00:00:00Z","file":"claude.ts","tool":"Write","claude_adds":80,"total":100}\n' >> "$LOG_FILE"
printf '{"ts":"2026-01-01T00:00:00Z","file":"cam.ts","tool":"Write","claude_adds":20,"total":100}\n' >> "$LOG_FILE"

printf 'x\n' >> "$REPO/claude.ts"
printf 'x\n' >> "$REPO/cam.ts"
git -C "$REPO" add claude.ts cam.ts

OUT="$(run_check)"
CLAUDE_SECTION="$(printf '%s' "$OUT" | awk '/CLAUDE-primary/,/CAM-primary/' | tail -n +2)"
CAM_SECTION="$(printf '%s' "$OUT" | awk '/CAM-primary/,0' | tail -n +2)"

assert_contains     "claude.ts in claude section" "$CLAUDE_SECTION" "claude.ts"
assert_not_contains "cam.ts NOT in claude section" "$CLAUDE_SECTION" "cam.ts"
assert_contains     "cam.ts in cam section"        "$CAM_SECTION"    "cam.ts"
assert_not_contains "claude.ts NOT in cam section" "$CAM_SECTION"    "claude.ts"
teardown_repo

section "check: deleted staged file excluded from table"
setup_repo
printf 'alive\n' > "$REPO/alive.ts"
printf 'dead\n'  > "$REPO/dead.ts"
git -C "$REPO" add alive.ts dead.ts && git -C "$REPO" commit -q -m "add both"

printf '{"ts":"2026-01-01T00:00:00Z","file":"dead.ts","tool":"Write","claude_adds":1,"total":1}\n' > "$LOG_FILE"
printf '{"ts":"2026-01-01T00:00:00Z","file":"alive.ts","tool":"Write","claude_adds":1,"total":1}\n' >> "$LOG_FILE"

printf 'changed\n' > "$REPO/alive.ts"
git -C "$REPO" rm -q dead.ts
git -C "$REPO" add alive.ts

OUT="$(run_check)"
assert_not_contains "deleted file not in output" "$OUT" "dead.ts"
assert_contains     "alive file in output"        "$OUT" "alive.ts"
teardown_repo

# ── summary ────────────────────────────────────────────────────────────────

PASS="$(grep '^P$' "$RESULTS" 2>/dev/null | wc -l | tr -d '[:space:]')"
FAIL="$(grep '^F$' "$RESULTS" 2>/dev/null | wc -l | tr -d '[:space:]')"

echo ""
echo "══════════════════════════════════════════════════"
echo "  Results: ${PASS} passed  ${FAIL} failed"
echo "══════════════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
