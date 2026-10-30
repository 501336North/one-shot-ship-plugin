#!/bin/bash
# Guard: every shell test that runs a hook first unsets OSS_CONFIG_DIR and OSS_MANIFEST_URL (T29).
#
# @behavior A developer who has OSS_CONFIG_DIR or OSS_MANIFEST_URL exported in their shell can run any
#           hook test without the hooks reading their real config (and key) or calling the real API or
#           manifest that config names. A new test that forgets the unset fails here, before it ships.
# @business-rule Tests never reach a configured config or API: only the sandbox HOME and local stubs.
#
# Detection rule ("this file runs a hook"), applied to every hooks/__tests__/*.test.sh and
# commands/__tests__/*.test.sh, ignoring comment-only lines:
#   - it names a production hook by PATH, i.e. "/<name>.sh" where hooks/<name>.sh exists
#     ("$SCRIPT_DIR/../oss-notify.sh", "$HOME/.oss/hooks/oss-log.sh", "$ROOT/hooks/oss-value.sh"), or
#   - it uses HOOKS_UNDER_TEST (the mutant-copy switch every hook-running test takes), or
#   - it globs the hooks directory ("hooks/*.sh").
#   A bare hook name with no "/" in front ("grep -q 'oss-log.sh init' file") is a text check, not a
#   run, so such a file is exempt. The rule over-includes on purpose: a file that only reads a hook by
#   path gets flagged too, and the one-line unset costs it nothing. A hook run through a fully computed
#   path ("$DIR/$name") is not seen; such a file should name its hook or use HOOKS_UNDER_TEST.
#
# What counts as hermetic: a line that starts with `unset` and names OSS_CONFIG_DIR, and one (or the
# same) that names OSS_MANIFEST_URL. `env -i` / `env -u` alone is NOT accepted: the guard cannot prove
# that every hook run in the file sits under it, and the unset line is cheap and visible. The unset must
# be a line of its own (not a comment, not after `;`), so a commented-out unset does not pass.
#
# Usage: ./hooks/__tests__/tests-hermetic-env.test.sh
#   HERMETIC_TEST_DIRS="dir1 dir2"  check the *.test.sh files in these directories instead (anti-vacuity)
set -uo pipefail
# This guard runs no hook; the unset keeps it consistent with the rule it enforces.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SELF="$(basename "${BASH_SOURCE[0]}")"
DIRS="${HERMETIC_TEST_DIRS:-$ROOT/hooks/__tests__ $ROOT/commands/__tests__}"

RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# "name1|name2|..." for every production hook, dots escaped for grep -E.
HOOK_NAMES=''
for h in "$ROOT"/hooks/*.sh; do
    [[ -f "$h" ]] || continue
    n=$(basename "$h" .sh)
    n=${n//./\\.}
    HOOK_NAMES="${HOOK_NAMES:+$HOOK_NAMES|}$n"
done
RUNS_HOOK="/($HOOK_NAMES)\\.sh([^A-Za-z0-9_.-]|\$)|HOOKS_UNDER_TEST|hooks/\\*\\.sh"

# $1 file. Exit 0 when it runs a hook (rule above). Not `grep -q`: it exits at the first match, the first
# grep then dies of SIGPIPE on a large file, and pipefail turns that into "no match".
runs_hook() { grep -vE '^[[:space:]]*#' "$1" | grep -E "$RUNS_HOOK" >/dev/null; }
# $1 file. Exit 0 when it has unset lines for both variables.
is_hermetic() {
    grep -qE '^[[:space:]]*unset[[:space:]]+([^#;]*[[:space:]])?OSS_CONFIG_DIR([[:space:]]|$)' "$1" &&
        grep -qE '^[[:space:]]*unset[[:space:]]+([^#;]*[[:space:]])?OSS_MANIFEST_URL([[:space:]]|$)' "$1"
}

# --- Controls: the rule itself flags what it should and exempts what it should ---
FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
printf '#!/bin/bash\nHOOK="$SCRIPT_DIR/../oss-notify.sh"\n"$HOOK" --workflow x\n' > "$FIX/runs.sh"
printf '#!/bin/bash\nunset OSS_CONFIG_DIR OSS_MANIFEST_URL\nHOOK="$SCRIPT_DIR/../oss-notify.sh"\n"$HOOK"\n' > "$FIX/runs-unset.sh"
printf '#!/bin/bash\n# unset OSS_CONFIG_DIR OSS_MANIFEST_URL\nHOOK="$SCRIPT_DIR/../oss-notify.sh"\n"$HOOK"\n' > "$FIX/runs-commented.sh"
printf '#!/bin/bash\ngrep -q "oss-log.sh init xray" "$WRAPPER"\n' > "$FIX/static.sh"
if runs_hook "$FIX/runs.sh" && ! is_hermetic "$FIX/runs.sh"; then pass "control: a test running a hook without the unset is flagged"
else fail "control: a test running a hook without the unset is flagged" "the rule did not flag it"; fi
if runs_hook "$FIX/runs-unset.sh" && is_hermetic "$FIX/runs-unset.sh"; then pass "control: the same test with the unset passes"
else fail "control: the same test with the unset passes" "the rule rejected it"; fi
if ! is_hermetic "$FIX/runs-commented.sh"; then pass "control: a commented-out unset does not count"
else fail "control: a commented-out unset does not count" "it was accepted"; fi
if ! runs_hook "$FIX/static.sh"; then pass "control: a file that only greps for a hook name is exempt"
else fail "control: a file that only greps for a hook name is exempt" "it was flagged"; fi

# --- The real tests ---
CHECKED=0
for d in $DIRS; do
    for f in "$d"/*.test.sh; do
        [[ -f "$f" ]] || continue
        [[ "$(basename "$f")" == "$SELF" ]] && continue
        runs_hook "$f" || continue
        CHECKED=$((CHECKED + 1))
        rel=${f#"$ROOT"/}
        if is_hermetic "$f"; then pass "$rel unsets OSS_CONFIG_DIR and OSS_MANIFEST_URL"
        else fail "$rel unsets OSS_CONFIG_DIR and OSS_MANIFEST_URL" "it runs a hook but has no 'unset' line for both"; fi
    done
done
if [[ $CHECKED -gt 0 ]]; then pass "found $CHECKED hook-running test files to check (the scan is not vacuous)"
else fail "found hook-running test files to check" "none matched in: $DIRS"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
