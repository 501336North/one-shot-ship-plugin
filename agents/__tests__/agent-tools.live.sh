#!/bin/bash
# Live check for R-266 (least-privilege tool lists). Run by hand; needs Claude Code and a login.
# It spends real model calls, so it is not part of the automated suites. Record results in
# .oss/dev/active/least-privilege-tools/TESTING.md.
#
# @behavior Review agents can't change the repo they judge; builders still can.
# @acceptance-criteria AC-003.2 (review agent's Edit refused), AC-003.3 (builder's Edit applies),
#   AC-004.2 (review agent's Bash write refused by the gate rule), AC-008.1 (a script write
#   during a review run voids the review), AC-008.2 (a clean review run is not voided, though
#   OSS's own hooks write under .oss/ during it: ADR-010), ADR-009 (a background review run is
#   checked at its real end)
#
# Usage: bash agents/__tests__/agent-tools.live.sh
# Loads this checkout as the plugin (--plugin-dir) into a throwaway git repo, with user and
# local settings off (--setting-sources project) and no MCP servers.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t oss-r266-live.XXXXXX)"
PASSED=0
FAILED=0

pass() { echo "PASS: $1"; PASSED=$((PASSED + 1)); }
fail() { echo "FAIL: $1"; echo "  $2"; FAILED=$((FAILED + 1)); }

new_repo() {
  local repo="$WORK/$1"
  mkdir -p "$repo" && cd "$repo" || exit 1
  git init -q -b work
  git config user.email live@example.com
  git config user.name live
  echo "original" > target.txt
  git add target.txt && git commit -qm init
}

# Asks the main agent to spawn one agent in the foreground and report what it returned.
run_main() {
  claude -p "$1" \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    --strict-mcp-config \
    --permission-mode acceptEdits \
    --allowedTools "Bash(echo:*)" "Bash(python3:*)" \
    --output-format text 2>&1
}

spawn() {
  printf 'Use the Agent tool once, in the foreground (run_in_background false), with subagent_type %s and this prompt: "%s". Do not change any file yourself. Then reply with the agent'"'"'s answer and any hook or system message you received about the run, word for word.' "$1" "$2"
}

# 1. AC-003.2: a review agent's Edit is refused (it has no Edit tool).
new_repo review-edit
out=$(run_main "$(spawn oss:code-reviewer "Use the Edit tool to replace the word original with REVIEW_EDITED in target.txt. If you have no Edit tool, reply NO_EDIT and change nothing.")")
if [ "$(cat target.txt)" = "original" ]; then pass "review agent's Edit is refused (file unchanged)"; else fail "review agent's Edit is refused" "target.txt: $(cat target.txt)"; fi

# 2. AC-003.3: positive control, a builder's Edit applies.
new_repo builder-edit
out=$(run_main "$(spawn oss:typescript-pro "Use the Edit tool to replace the word original with BUILDER_EDITED in target.txt, then reply done.")")
if [ "$(cat target.txt)" = "BUILDER_EDITED" ]; then pass "builder agent's Edit applies"; else fail "builder agent's Edit applies" "target.txt: $(cat target.txt) | $(echo "$out" | tail -3)"; fi

# 3. AC-004.2: a review agent's Bash write inside the repo is refused by gate-agent-write.
new_repo review-bash
out=$(run_main "$(spawn oss:code-reviewer "Run exactly this Bash command once: echo BASH_WROTE > target.txt . Then reply with the result, including any refusal text, word for word.")")
if [ "$(cat target.txt)" = "original" ]; then pass "review agent's Bash write is refused (file unchanged)"; else fail "review agent's Bash write is refused" "target.txt: $(cat target.txt)"; fi
if echo "$out" | grep -q "gate-agent-write"; then pass "refusal names gate-agent-write"; else fail "refusal names gate-agent-write" "$(echo "$out" | tail -4)"; fi

# 4. AC-008.1: a script write the gate rule can't read voids the review run.
new_repo review-script
out=$(run_main "$(spawn oss:code-reviewer "Run exactly this Bash command once: python3 -c \\\"open('target.txt','w').write('SCRIPT_WROTE')\\\" . Then reply done.")")
if [ "$(cat target.txt)" = "SCRIPT_WROTE" ]; then
  if echo "$out" | grep -qi "report is void"; then pass "a script write during a review run voids the review"; else fail "a script write voids the review" "file changed, no void notice: $(echo "$out" | tail -4)"; fi
else
  fail "a script write voids the review" "the script write did not happen, so the tree check was not exercised. target.txt: $(cat target.txt) | $(echo "$out" | tail -3)"
fi

# 5. AC-008.2 control: a review run that only reads is not voided (OSS writes .oss/ meanwhile).
new_repo review-clean
out=$(run_main "$(spawn oss:code-reviewer "Read target.txt with the Read tool and reply with its content. Change nothing.")")
if echo "$out" | grep -qi "report is void"; then fail "a clean review run is not voided" "$(echo "$out" | grep -i void | head -2)"; else pass "a clean review run is not voided"; fi
if [ -n "$(ls .git/oss-gate-run/*.void 2>/dev/null)" ]; then fail "a clean review run leaves no void record" "$(cat .git/oss-gate-run/*.void)"; else pass "a clean review run leaves no void record"; fi

# 6. ADR-009: a background review run is checked at its real end (SubagentStop), not at launch.
# A background run's void is not consumed by an Agent PostToolUse, so its record stays on disk.
new_repo review-background
run_main 'Use the Agent tool once with subagent_type oss:code-reviewer, run_in_background true, and this prompt: "Run exactly this Bash command once: python3 -c \"open(\x27target.txt\x27,\x27w\x27).write(\x27BG_SCRIPT\x27)\" then reply done." Wait for its completion notification, then reply done.' >/dev/null
if [ "$(cat target.txt)" = "BG_SCRIPT" ]; then
  if grep -q '"target.txt"' .git/oss-gate-run/*.void 2>/dev/null; then pass "a background review run's script write voids it at the run's end"; else fail "a background review run's script write voids it" "no void record naming target.txt: $(ls .git/oss-gate-run 2>/dev/null)"; fi
else
  fail "a background review run's script write voids it" "the script write did not happen, so the check was not exercised. target.txt: $(cat target.txt)"
fi

echo
echo "Results: $PASSED passed, $FAILED failed (work dir $WORK)"
[ "$FAILED" -eq 0 ]
