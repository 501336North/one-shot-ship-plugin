#!/bin/bash
# The plugin's `npm test` runs every shell test file and fails when any one fails (D6).
#
# @behavior The ship merge step runs `npm test` at the repo root; it passes only when every
#           `__tests__/*.test.sh` file in the plugin passes on its own, and a failure names the file.
# @business-rule D6 (owner, 2026-11-11): the plugin repo gets a root package.json so /oss:ship --merge can
#           test and merge plugin PRs. The watcher's vitest suite is not part of it (its setup kills OSS
#           processes machine-wide).
#
# Usage: /bin/bash scripts/__tests__/run-shell-tests.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$ROOT/scripts/run-shell-tests.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running run-shell-tests tests..."

F=$(mktemp -d); trap 'rm -rf "$F"' EXIT
mkdir -p "$F/__tests__" "$F/hooks/__tests__" "$F/watcher/node_modules/x/__tests__"
printf 'exit 0\n' > "$F/__tests__/ok.test.sh"
printf 'exit 0\n' > "$F/hooks/__tests__/also-ok.test.sh"
printf 'exit 1\n' > "$F/watcher/node_modules/x/__tests__/vendored.test.sh"

out=$(/bin/bash "$RUNNER" "$F" 2>&1); rc=$?
[[ $rc -eq 0 ]] && pass "all passing test files: exit 0 (node_modules is never run)" \
    || fail "all passing test files: exit 0 (node_modules is never run)" "rc=$rc out=$out"
[[ "$out" != *"unbound variable"* && "$out" != *"line "*": "* ]] && pass "a passing run prints no shell error (its clean-up included)" \
    || fail "a passing run prints no shell error (its clean-up included)" "out=$out"

printf 'exit 3\n' > "$F/hooks/__tests__/broken.test.sh"
out=$(/bin/bash "$RUNNER" "$F" 2>&1); rc=$?
[[ $rc -ne 0 ]] && pass "one failing test file: non-zero exit" || fail "one failing test file: non-zero exit" "rc=0"
[[ "$out" == *"hooks/__tests__/broken.test.sh"* ]] && pass "the failing file is named" \
    || fail "the failing file is named" "out=$out"

# Ship round 1 (plugin-main-fixes): the merge gate must never pass on tests it did not run, and never hang.
# Each runner call is capped at 60 s here, so a runner without a time limit fails instead of hanging this file.
run() { perl -e 'alarm 60; exec @ARGV' /bin/bash "$RUNNER" "$@" 2>&1; }

out=$(run "$F/does-not-exist"); rc=$?
[[ $rc -ne 0 ]] && pass "a root that does not exist: non-zero exit" || fail "a root that does not exist: non-zero exit" "rc=0 out=$out"

E=$(mktemp -d); mkdir -p "$E/tests"; printf 'exit 0\n' > "$E/tests/moved.test.sh"
out=$(run "$E"); rc=$?
[[ $rc -ne 0 ]] && pass "no __tests__/*.test.sh found: non-zero exit (nothing ran)" || fail "no __tests__/*.test.sh found: non-zero exit (nothing ran)" "rc=0 out=$out"
rm -rf "$E"

S=$(mktemp -d); mkdir -p "$S/__tests__" "$S/real"; printf 'exit 0\n' > "$S/__tests__/ok.test.sh"
printf 'exit 1\n' > "$S/real/linked.test.sh"; ln -s "$S/real/linked.test.sh" "$S/__tests__/linked.test.sh"
out=$(run "$S"); rc=$?
[[ $rc -ne 0 && "$out" == *"__tests__/linked.test.sh"* ]] && pass "a symlinked test file fails and is named" || fail "a symlinked test file fails and is named" "rc=$rc out=$out"
rm -rf "$S"; S=$(mktemp -d); mkdir -p "$S/a/__tests__" "$S/elsewhere"; printf 'exit 0\n' > "$S/a/__tests__/ok.test.sh"
printf 'exit 1\n' > "$S/elsewhere/hidden.test.sh"; ln -s "$S/elsewhere" "$S/b"
out=$(run "$S"); rc=$?
[[ $rc -ne 0 && "$out" == *"FAILED: b (a symlink"* ]] && pass "a symlinked folder fails and is named" || fail "a symlinked folder fails and is named" "rc=$rc out=$out"
rm -rf "$S"

N=$(mktemp -d); mkdir -p "$N/__tests__"; printf 'exit 0\n' > "$N/__tests__/ok"; printf 'exit 0\n' > "$N/ok2.test.sh"
printf 'exit 1\n' > "$N/__tests__/ok"$'\n'"ok2.test.sh"
out=$(cd "$N" && run "$N"); rc=$?
[[ $rc -ne 0 ]] && pass "a failing test file with a newline in its name fails" || fail "a failing test file with a newline in its name fails" "rc=0 out=$out"
rm -rf "$N"

H=$(mktemp -d); mkdir -p "$H/__tests__"; printf 'exit 0\n' > "$H/__tests__/quick.test.sh"; printf 'sleep 300\n' > "$H/__tests__/hangs.test.sh"
s0=$SECONDS; out=$(RUN_SHELL_TESTS_TIMEOUT=2 run "$H"); rc=$?
[[ $rc -ne 0 && "$out" == *"__tests__/hangs.test.sh"* && $((SECONDS - s0)) -lt 30 ]] && pass "a test file that hangs is stopped at the time limit, fails and is named" || fail "a test file that hangs is stopped at the time limit, fails and is named" "rc=$rc after $((SECONDS - s0)) s out=$out"
[[ "$out" == *"__tests__/quick.test.sh"* ]] && pass "each test file is named as it runs" || fail "each test file is named as it runs" "out=$out"
rm -rf "$H"

M=$(mktemp -d); mkdir -p "$M/__tests__"
printf 'test "$HOME" != %q && test -d "$HOME" && test -z "$(ls -A "$HOME")"\n' "$HOME" > "$M/__tests__/home.test.sh"
out=$(run "$M"); rc=$?
[[ $rc -eq 0 ]] && pass "each test file gets its own empty HOME, never the real one" || fail "each test file gets its own empty HOME, never the real one" "rc=$rc out=$out"
rm -rf "$M"

# fetch-fallback.test.sh runs the installed, hash-pinned oss-decrypt from the real home; with its own HOME a test
# file still gets it through OSS_DECRYPT_UNDER_TEST (unless the caller set that already).
M=$(mktemp -d); mkdir -p "$M/__tests__"
printf 'test "${OSS_DECRYPT_UNDER_TEST:-}" = %q\n' "$HOME/.oss/bin/oss-decrypt" > "$M/__tests__/decrypt.test.sh"
out=$(env -u OSS_DECRYPT_UNDER_TEST /bin/bash -c "$(declare -f run); RUNNER=$(printf %q "$RUNNER"); run $(printf %q "$M")"); rc=$?
[[ $rc -eq 0 ]] && pass "a test file is pointed at the real home's oss-decrypt" || fail "a test file is pointed at the real home's oss-decrypt" "rc=$rc out=$out"
rm -rf "$M"

# Ship round 2 (plugin-main-fixes): no test file can escape the time limit, leave processes behind, see the
# caller's environment, run without its own HOME, or rewrite the runner into a pass.
H=$(mktemp -d); mkdir -p "$H/__tests__"
printf "trap '' ALRM; sleep 300\n" > "$H/__tests__/ignores-alarm.test.sh"
printf "exec perl -e 'alarm 0; sleep 300'\n" > "$H/__tests__/resets-alarm.test.sh"
s0=$SECONDS; out=$(RUN_SHELL_TESTS_TIMEOUT=2 run "$H"); rc=$?
[[ $rc -ne 0 && "$out" == *"ignores-alarm.test.sh (stopped"* && "$out" == *"resets-alarm.test.sh (stopped"* && $((SECONDS - s0)) -lt 30 ]] \
    && pass "a test file that ignores or resets the alarm is still stopped at the limit" \
    || fail "a test file that ignores or resets the alarm is still stopped at the limit" "rc=$rc after $((SECONDS - s0)) s out=$out"
rm -rf "$H"; H=$(mktemp -d); mkdir -p "$H/__tests__"
s0=$SECONDS; out=$(RUN_SHELL_TESTS_TIMEOUT=2 perl -e '$SIG{ALRM}="IGNORE"; exec @ARGV' /bin/bash -c "$(declare -f run); RUNNER=$(printf %q "$RUNNER"); printf 'sleep 300\n' > $(printf %q "$H/__tests__/hangs.test.sh"); run $(printf %q "$H")"); rc=$?
[[ $rc -ne 0 && "$out" == *"hangs.test.sh (stopped"* && $((SECONDS - s0)) -lt 30 ]] \
    && pass "the limit holds when the caller ignores SIGALRM" || fail "the limit holds when the caller ignores SIGALRM" "rc=$rc after $((SECONDS - s0)) s out=$out"
rm -rf "$H"; H=$(mktemp -d); mkdir -p "$H/__tests__"; mark="rst-leak-$$-$RANDOM"
printf 'perl -e %q 300 &\nexit 0\n' "\$0='$mark'; sleep shift" > "$H/__tests__/leaves-child.test.sh"
out=$(RUN_SHELL_TESTS_TIMEOUT=20 run "$H"); rc=$?; sleep 1
left=$(pgrep -f "$mark")
[[ $rc -ne 0 && "$out" == *"leaves-child.test.sh (left a process running"* && -z "$left" ]] \
    && pass "a test file that leaves a process behind fails, and the process is killed" \
    || fail "a test file that leaves a process behind fails, and the process is killed" "rc=$rc left=$left out=$out"
[[ -n "$left" ]] && kill $left 2>/dev/null
rm -rf "$H"

H=$(mktemp -d); mkdir -p "$H/__tests__"; printf 'exit 0\n' > "$H/__tests__/ok.test.sh"
for v in 0 86401 99999999999999999999 x; do
    out=$(RUN_SHELL_TESTS_TIMEOUT=$v run "$H"); rc=$?
    [[ $rc -ne 0 && "$out" == *"RUN_SHELL_TESTS_TIMEOUT"* ]] && pass "a time limit of '$v' is refused" || fail "a time limit of '$v' is refused" "rc=$rc out=$out"
done
rm -rf "$H"

M=$(mktemp -d); mkdir -p "$M/__tests__"
printf 'test -z "${OSS_CONFIG_DIR+x}${CLAUDE_PROJECT_DIR+x}${HOOKS_UNDER_TEST+x}${XDG_CONFIG_HOME+x}${SSH_AUTH_SOCK+x}" && test -n "$PATH" && test -n "$TMPDIR"\n' > "$M/__tests__/env.test.sh"
out=$(OSS_CONFIG_DIR=/x CLAUDE_PROJECT_DIR=/x HOOKS_UNDER_TEST=/x XDG_CONFIG_HOME=/x SSH_AUTH_SOCK=/x TMPDIR="${TMPDIR:-/tmp}" run "$M"); rc=$?
[[ $rc -eq 0 ]] && pass "a test file sees none of the caller's OSS, project, *_UNDER_TEST or SSH-agent settings, only PATH, TMPDIR and the like" \
    || fail "a test file sees none of the caller's OSS, project, *_UNDER_TEST or SSH-agent settings, only PATH, TMPDIR and the like" "rc=$rc out=$out"
rm -rf "$M"

M=$(mktemp -d); mkdir -p "$M/__tests__" "$M/bin"; printf 'exit 0\n' > "$M/__tests__/ok.test.sh"
printf '#!/bin/sh\nfor a; do [ "$a" = -d ] && exit 1; done\nexec /usr/bin/mktemp "$@"\n' > "$M/bin/mktemp"; chmod +x "$M/bin/mktemp"
out=$(PATH="$M/bin:$PATH" run "$M"); rc=$?
[[ $rc -ne 0 && "$out" == *"ok.test.sh (no HOME"* ]] && pass "a test file whose own HOME cannot be made fails, never runs with no HOME" \
    || fail "a test file whose own HOME cannot be made fails, never runs with no HOME" "rc=$rc out=$out"
rm -rf "$M"

W=$(mktemp -d); mkdir -p "$W/__tests__" "$W/scripts" "$W/hooks/__tests__/lib"; cp "$RUNNER" "$W/scripts/runner.sh"
cp "$ROOT/hooks/__tests__/lib/run-capped.sh" "$W/hooks/__tests__/lib/"
printf 'exit 1\n' > "$W/__tests__/a-fails.test.sh"
cat > "$W/__tests__/b-rewrites.test.sh" <<EOF
perl -e 'local \$/; open my \$f, "+<", \$ARGV[0] or exit 0; my \$s = <\$f>; my \$i = index(\$s, "failed+=(\"\\\$rel\")"); exit 0 if \$i < 0;
  \$i = index(\$s, "\\n", \$i) + 1; my \$x = "echo All 2 shell test files passed; exit 0\\n"; seek \$f, \$i, 0; print \$f \$x; close \$f;
  open my \$m, ">", \$ARGV[1]; close \$m' $(printf %q "$W/scripts/runner.sh") $(printf %q "$W/rewrote")
EOF
out=$(perl -e 'alarm 60; exec @ARGV' /bin/bash "$W/scripts/runner.sh" "$W" 2>&1); rc=$?
[[ -e "$W/rewrote" && $rc -ne 0 && "$out" == *"a-fails.test.sh"* ]] && pass "a test file that rewrites the runner while it runs cannot turn a failure into a pass" \
    || fail "a test file that rewrites the runner while it runs cannot turn a failure into a pass" "rc=$rc out=$out"
rm -rf "$W"

# Ship round 4 (owner: keep fixing until clean): the whole list is read before any test runs, a caller's Ctrl-C
# or TERM takes the running test down with it, and a caller that blocks SIGALRM cannot switch the limit off.
K=$(mktemp -d); long=$(printf 'd%.0s' {1..200})
for i in $(seq -w 1 400); do mkdir -p "$K/m$i$long/__tests__"; printf 'exit 0\n' > "$K/m$i$long/__tests__/t.test.sh"; done
mkdir -p "$K/a/__tests__" "$K/z/__tests__"; printf 'exit 1\n' > "$K/z/__tests__/z.test.sh"
cat > "$K/a/__tests__/a.test.sh" <<'EOF'
r=$(ps -o ppid= -p "$PPID" | tr -d ' ')   # this file's parent is run_capped's perl; its parent is the runner
for c in $(pgrep -P "$r") $(for k in $(pgrep -P "$r"); do pgrep -P "$k"; done); do   # bash 3.2 puts sort under a subshell
  case "$(ps -o comm= -p "$c")" in *sort) kill -KILL "$c" ;; esac
done
exit 0
EOF
out=$(run "$K"); rc=$?
[[ $rc -ne 0 && "$out" == *"z/__tests__/z.test.sh"* ]] && pass "a test file that kills the file-list sort cannot skip the files after it" \
    || fail "a test file that kills the file-list sort cannot skip the files after it" "rc=$rc tail=$(printf '%s' "$out" | tail -2)"
rm -rf "$K"

H=$(mktemp -d); mkdir -p "$H/__tests__"; mark="rst-int-$$-$RANDOM"
printf 'exec perl -e %q 300\n' "\$0='$mark'; sleep shift" > "$H/__tests__/sleeps.test.sh"
perl -e 'setpgrp(0, 0); exec @ARGV' /bin/bash "$RUNNER" "$H" >/dev/null 2>&1 & rp=$!
for _ in $(seq 50); do pgrep -f "$mark" >/dev/null && break; sleep 0.1; done
kill -INT -"$rp" 2>/dev/null; sleep 3
left=$(pgrep -f "$mark")
[[ -z "$left" ]] && pass "Ctrl-C on the run (SIGINT to its group) also stops the running test file" \
    || fail "Ctrl-C on the run (SIGINT to its group) also stops the running test file" "still running: $left"
[[ -n "$left" ]] && kill $left 2>/dev/null; wait "$rp" 2>/dev/null
rm -rf "$H"

H=$(mktemp -d); mkdir -p "$H/__tests__"; mark="rst-alrm-$$-$RANDOM"
printf 'exec perl -e %q 300\n' "\$0='$mark'; sleep shift" > "$H/__tests__/hangs.test.sh"
s0=$SECONDS; out=$(RUN_SHELL_TESTS_TIMEOUT=2 perl -MPOSIX -e 'sigprocmask(SIG_BLOCK, POSIX::SigSet->new(SIGALRM)); exec @ARGV' /bin/bash -c "$(declare -f run); RUNNER=$(printf %q "$RUNNER"); run $(printf %q "$H")"); rc=$?
[[ $rc -ne 0 && "$out" == *"hangs.test.sh (stopped"* && $((SECONDS - s0)) -lt 30 ]] \
    && pass "the limit holds when the caller blocks SIGALRM" || fail "the limit holds when the caller blocks SIGALRM" "rc=$rc after $((SECONDS - s0)) s out=$out"
sleep 1; left=$(pgrep -f "$mark")
[[ -z "$left" ]] && pass "the limit under a blocked SIGALRM also ends the test's process" \
    || fail "the limit under a blocked SIGALRM also ends the test's process" "still running: $left"
[[ -n "$left" ]] && kill $left 2>/dev/null
rm -rf "$H"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
