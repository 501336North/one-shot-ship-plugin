#!/bin/bash
# /oss:ship describes --merge the way the served merge step works.
#
# @behavior A user reading /oss:ship learns that --merge merges the PR in this session once its required
#           checks pass and any approval branch protection asks for is in, and never queues an auto-merge;
#           when the merge step stops, the status line still finishes and the user hears what to re-run.
# @business-rule The served ship merge step (API #432) merges with `gh pr merge --squash --match-head-commit`
#           and never `--auto` or `--admin`; merge consent is the --merge flag or the user's own message.
set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
F="$C/ship.md"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"
    else echo "✗ FAIL: $1"; printf '    %s\n' "$2"; FAILED=$((FAILED + 1)); fi
}
has() { grep -qF -- "$1" "$F" || echo "missing: $1"; }

check "ship.md never tells the model to run gh pr merge --auto" "$(grep -n -- 'gh pr merge' "$F" | grep -F -- '--auto')"
check "ship.md never promises an auto-merge (only /oss:auto may say auto)" \
    "$(grep -n -i 'auto-merge\|automerge\|auto merge' "$F")"
check "ship.md says the merge never uses --auto or --admin" "$(has 'never uses `--auto` or `--admin`')"
check "ship.md says --merge waits for required checks and a required approval" \
    "$(has 'once its required checks pass and any approval branch protection asks for is in')"
check "ship.md says what to send when the merge step stops or cannot merge" \
    "$(has 'If the merge step stopped or could not merge')"
# a `complete` after a stopped merge would run the team's chain (deploy, for example) on an unmerged PR
check "ship.md never sends complete when the merge step stopped" \
    "$(has 'send neither `merged` nor `complete`')"
check "ship.md never sends complete right after pr_created under --merge" \
    "$(grep -n 'If the merge step stopped' "$F" | grep -F 'send `complete` once right after `pr_created`')"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
