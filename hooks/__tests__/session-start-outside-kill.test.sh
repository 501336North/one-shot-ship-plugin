#!/bin/bash
# The session-start tests give the same result while another checkout's watcher suite runs (T42, T43).
#
# @behavior A developer runs the hook tests while a vitest run from another checkout of this repo is going
#           on. Every checkout older than 225b685 runs `pkill -f "oss-session-start"` in its vitest setup,
#           machine-wide, for each test file. A test that runs the hook under its real file name has the
#           hook killed mid-run: no output, no telegram cleanup, no notification. These tests must not be
#           able to fail that way, so they run the hook under a name that pattern does not match.
# @business-rule A flaky test is a broken test (IRON LAW #2): its result depends only on the code under test.
#
# How: a `mkdir` stub first on PATH does what that setup does, the moment the hook makes ~/.oss (its first
# command), so the kill lands mid-run every time, with no load and no timing. A test that runs the hook with
# its own PATH never meets that stub, so a BASH_ENV file (read by every non-interactive bash, whatever its
# PATH) does the same kill when a bash starts with the name on its command line. Both kills are scoped to
# this test's own process group, so nothing else on the machine is touched.
#
# Usage: /bin/bash hooks/__tests__/session-start-outside-kill.test.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Own process group (the kill below is scoped to it): re-exec once as a group leader.
if [[ -z "${OSS_KILL_PGID:-}" ]]; then
    OSS_KILL_PGID=self exec perl -e 'setpgrp(0, 0); $ENV{OSS_KILL_PGID} = $$; exec @ARGV' /bin/bash "${BASH_SOURCE[0]}" "$@"
fi
export OSS_KILL_PGID
source "$SCRIPT_DIR/lib/warm-stub.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN+1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN+1)); FAILED=$((FAILED+1)); }
echo "Running session-start-outside-kill tests..."

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
MKDIR=$(command -v mkdir)
# BSD pkill skips its own ancestors unless -a; procps pkill has no -a (and skips only itself).
warm_stub "$KS/killer/mkdir" "pkill -a -g \"\$OSS_KILL_PGID\" -f oss-session-start 2>/dev/null || pkill -g \"\$OSS_KILL_PGID\" -f oss-session-start 2>/dev/null
exec \"$MKDIR\" \"\$@\"" || { echo "✗ FAIL: stub warm-up — the mkdir stub did not run"; exit 1; }

# The BASH_ENV kill: every bash that starts runs the same scoped pkill, absolute path (the test may have
# replaced PATH). Unconditional: while BASH_ENV is read, bash 3.2's $0 is still /bin/bash, not the script.
cat > "$KS/kill.env" <<'ENV'
/usr/bin/pkill -a -g "$OSS_KILL_PGID" -f oss-session-start 2>/dev/null || /usr/bin/pkill -g "$OSS_KILL_PGID" -f oss-session-start 2>/dev/null
ENV

# Anchor: the stub really kills a process whose command line holds the name (else every case is vacuous).
[[ "$(ps -o pgid= -p $$ | tr -d ' ')" == "$OSS_KILL_PGID" ]] && pass "this test leads its own process group (anchor)" \
    || fail "this test leads its own process group (anchor)" "pgid=$(ps -o pgid= -p $$) want=$OSS_KILL_PGID"
probe_rc=$( { ( exec -a oss-session-start-probe sleep 30 ) >/dev/null & p=$!
    "$KS/killer/mkdir" -p "$KS/made"; wait "$p"; echo $?; } 2>/dev/null )   # 2>/dev/null: the "Terminated" job notice
if [[ $probe_rc -ne 0 && -d "$KS/made" ]]; then pass "the stub kills an oss-session-start process and still makes the dir (anchor)"
else fail "the stub kills an oss-session-start process and still makes the dir (anchor)" "probe rc=$probe_rc"; fi

mkdir -p "$KS/probe"; printf 'exit 0\n' > "$KS/probe/oss-session-start-probe.sh"; printf 'exit 0\n' > "$KS/probe/other-probe.sh"
env_rc=$(BASH_ENV="$KS/kill.env" PATH=/nonexistent /bin/bash "$KS/probe/oss-session-start-probe.sh" 2>/dev/null; echo $?)
ctl_rc=$(BASH_ENV="$KS/kill.env" PATH=/nonexistent /bin/bash "$KS/probe/other-probe.sh" 2>/dev/null; echo $?)
if [[ $env_rc -ne 0 && $ctl_rc -eq 0 ]]; then pass "the BASH_ENV kill ends a bash run by that name, with no PATH, and only that one (anchor)"
else fail "the BASH_ENV kill ends a bash run by that name, and only that one (anchor)" "named rc=$env_rc other rc=$ctl_rc"; fi

# Every test file that showed the failure: it still passes with the kill landing mid-run.
# T48: and every other test file that runs session start (all of them route it through lib/session-start-alias.sh).
for f in oss-settings-telegram-cleanup session-start-notify-payload oss-config-one-object \
    optional-helper-source oss-config-one-read oss-value session-routing session-start-copy \
    session-start-iron-laws session-start-no-hook-downgrade session-start-timeout-fallback; do
    out=$(BASH_ENV="$KS/kill.env" PATH="$KS/killer:$PATH" /bin/bash "$SCRIPT_DIR/$f.test.sh" 2>&1 </dev/null); rc=$?
    if [[ $rc -eq 0 ]]; then pass "$f passes while session start is pkill'ed by name"
    else fail "$f passes while session start is pkill'ed by name" "rc=$rc $(printf '%s\n' "$out" | grep -m3 'FAIL' | cut -c1-200 | tr '\n' ' ')"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
