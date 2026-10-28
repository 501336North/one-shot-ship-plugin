#!/bin/bash
# Every plugin deploy must bump .claude-plugin/plugin.json "version" -- that bump is what makes installs
# auto-update. If any shipped path differs from origin/main (tracked or untracked), the version must be
# strictly greater than origin/main's, by SemVer precedence (hooks/oss-semver.sh: 2.1.0-beta.1 < 2.1.0).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SHIPPED=(hooks commands agents skills .claude-plugin watcher/src)
if ! git rev-parse --verify -q origin/main >/dev/null; then echo "SKIP: origin/main not found"; exit 0; fi
source "$ROOT/hooks/oss-semver.sh" || exit 1
ver() { grep -m1 '"version"' | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/'; }
RUN=0; FAILED=0
chk() { ((RUN++)); if eval "$2"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; ((FAILED++)); fi; }
changed=0
git diff --quiet origin/main -- "${SHIPPED[@]}" || changed=1
[[ -n "$(git status --porcelain -- "${SHIPPED[@]}")" ]] && changed=1
if [[ $changed -eq 0 ]]; then
  chk "no shipped path differs from origin/main, no bump required" 'true'
else
  base="$(git show origin/main:.claude-plugin/plugin.json | ver)"
  cur="$(ver < .claude-plugin/plugin.json)"
  echo "  origin/main=$base working-tree=$cur"
  chk "shipped paths changed, so plugin.json version ($cur) is greater than origin/main ($base)" \
    '[[ -n "$cur" && "$(oss_semver_cmp "$cur" "$base")" == 1 ]]'
fi
echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; [[ $FAILED -eq 0 ]]
