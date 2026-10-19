#!/bin/bash
# Session start copies the decrypt installer AND its committed manifest into ~/.oss/hooks (behavioural).
# Usage: ./hooks/__tests__/session-start-copy.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

# F10: the manifest is copied, readable, and NOT made executable (it is data, not a script)
T=$(mktemp -d)
HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" bash "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null
M="$T/.oss/hooks/oss-decrypt-checksums.txt"
if [[ -f "$M" && ! -x "$M" && -x "$T/.oss/hooks/ensure-decrypt-cli.sh" ]]; then pass "manifest copied as data (not executable), hook executable"
else fail "manifest copied as data" "exists=$([[ -f $M ]] && echo y || echo n) exec=$([[ -x $M ]] && echo y || echo n)"; fi
rm -rf "$T"

# F12: the write guard ships beside the hooks that source it, so ~/.oss/hooks/oss-log.sh still
#      writes a normal project's logs (without it every project-local write is refused).
T=$(mktemp -d); mkdir -p "$T/proj"
HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" bash "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null
HOME="$T" CLAUDE_PROJECT_DIR="$T/proj" bash "$T/.oss/hooks/oss-log.sh" write build "hello" >/dev/null 2>&1 </dev/null
if [[ -f "$T/.oss/hooks/oss-safe-path.sh" ]] && grep -q hello "$T/proj/.oss/logs/current-session/build.log" 2>/dev/null; then
    pass "oss-safe-path.sh copied; ~/.oss/hooks/oss-log.sh writes project logs"
else fail "oss-safe-path.sh copied; ~/.oss/hooks/oss-log.sh writes project logs" "guard=$([[ -f $T/.oss/hooks/oss-safe-path.sh ]] && echo y || echo n)"; fi
rm -rf "$T"

# G21 P4: served prompts call ~/.oss/hooks/oss-value.sh, so session start installs it, runnable,
#         beside the oss-safe-path.sh and oss-notify.sh it uses (its `dir` verb works from there).
T=$(mktemp -d); mkdir -p "$T/repo"; (cd "$T/repo" && git init -q) >/dev/null 2>&1
HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" bash "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null
V="$T/.oss/hooks/oss-value.sh"
out=$(cd "$T/repo" && HOME="$T" "$V" dir 2>/dev/null </dev/null)
if [[ -x "$V" && -n "$out" && -d "$out" ]]; then pass "oss-value.sh copied, executable, and its dir verb works from ~/.oss/hooks"
else fail "oss-value.sh copied, executable, and its dir verb works from ~/.oss/hooks" "exists=$([[ -f $V ]] && echo y || echo n) exec=$([[ -x $V ]] && echo y || echo n) dir='$out'"; fi
rm -rf "$T"

# F11: every session-start variant that copies the installer also copies its manifest
for f in "$ROOT"/hooks/oss-session-start*.sh; do
  if grep -q '"ensure-decrypt-cli.sh"' "$f" && ! grep -q '"oss-decrypt-checksums.txt"' "$f"; then
    fail "$(basename "$f") copies the manifest" "copies ensure-decrypt-cli.sh without oss-decrypt-checksums.txt"
  else pass "$(basename "$f") copies the manifest with the installer"; fi
done
for f in "$ROOT"/hooks/oss-session-start*.sh; do
  if grep -q '"oss-decrypt-checksums.txt"' "$f" && grep -qE '^\s*chmod \+x ~/.oss/hooks/\$hook\s*$' "$f"; then
    fail "$(basename "$f") keeps data files non-executable" "unconditional chmod +x in the copy loop"
  else pass "$(basename "$f") keeps data files non-executable"; fi
done
echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
