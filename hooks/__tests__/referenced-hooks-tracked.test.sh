#!/bin/bash
# Recurrence guard: every hook the plugin wires up must exist AND be committed.
#
# @behavior A fresh plugin install contains every hook that session start copies or runs,
#           and every ~/.oss/hooks/*.sh that a command tells Claude to run.
# @business-rule PR #150 wired oss-iron-laws-sync.sh into session start, login, ideate and auto
#           but never committed it; every release from 2.0.51 to 2.0.83 shipped without it,
#           and session start silently skipped the sync. A file that exists only on the author's
#           machine is not shipped, so "exists" alone is not enough: it must be tracked by git.
#
# Usage: ./hooks/__tests__/referenced-hooks-tracked.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION_START="$ROOT/hooks/oss-session-start.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

check() { # $1 = repo-relative path, $2 = where it is referenced
  local rel="$1" where="$2"
  if [[ ! -f "$ROOT/$rel" ]]; then fail "$rel ($where)" "missing from the plugin"
  elif ! (cd "$ROOT" && git ls-files --error-unmatch "$rel" >/dev/null 2>&1); then fail "$rel ($where)" "exists but is not tracked by git"
  else pass "$rel exists and is tracked ($where)"; fi
}

# 1. Every entry of HOOKS_TO_COPY
copied=$(sed -n '/^HOOKS_TO_COPY=(/,/^)/p' "$SESSION_START" | grep -oE '"[^"]+"' | tr -d '"')
[[ -n "$copied" ]] || fail "HOOKS_TO_COPY parsed" "no entries found in $SESSION_START"
for h in $copied; do check "hooks/$h" "HOOKS_TO_COPY"; done

# 2. Every $PLUGIN_ROOT/hooks/X.sh session start runs or copies
for h in $(grep -oE '\$PLUGIN_ROOT/hooks/[A-Za-z0-9_.-]+\.sh' "$SESSION_START" | sed 's#.*/##' | sort -u); do
  check "hooks/$h" "oss-session-start.sh \$PLUGIN_ROOT/hooks"
done

# 3. Every ~/.oss/hooks/X.sh (or $HOME/.oss/hooks/X.sh) referenced by a command
for h in $(grep -ohE '(~|\$HOME|\$\{HOME\})/\.oss/hooks/[A-Za-z0-9_.-]+\.sh' "$ROOT"/commands/*.md | sed 's#.*/##' | sort -u); do
  check "hooks/$h" "commands/*.md"
done

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
