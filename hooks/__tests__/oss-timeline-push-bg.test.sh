#!/bin/bash
# The detached timeline push is out of the caller's process group the moment `oss-timeline.sh push --detach` returns
# (R-273, DESIGN Amendment 3 R2-5).
#
# @behavior A caller (a hook runner, a test harness) that holds a process group, runs `oss-timeline.sh push
#           --detach` and looks at its group the instant the call returns finds nothing of the push in it: the
#           push already runs, in a process group of its own. The same holds on a machine with no perl.
# @business-rule A caller that kills or waits on its own process group must never cut a timeline POST short, wait
#           for one, or count it as a process it left behind. Before this fix the push left the group only once
#           perl had started, a few ms after the hook returned, and an API integration row that snapshots its
#           group (served-paths.real-hooks.integration.test.ts:558) failed now and then.
#
# How the race is made deterministic, with no sleep before the check: every perl started under the holder loads
# a gate module (PERL5OPT) that waits, before any of perl's own code runs, until the holder has taken its
# snapshot (2 s at most). Code that leaves the group only from inside a backgrounded perl is therefore always
# still in the group at the snapshot; code that has the push in its own group before the hook returns passes.
#
# The REAL hook runs with a sandbox HOME whose OSS config points at a fake API (hooks/__tests__/fake-oss-api.sh)
# that holds the timeline POST for 30 s, so the push is alive at the snapshot; the test then kills that push's
# own group, found by its pid in the snapshot (never by name).
# Usage: /bin/bash hooks/__tests__/oss-timeline-push-bg.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK PERL5OPT PERL5LIB
export OSS_ALLOW_HTTP_LOOPBACK=1   # the fake API stands at a plain-http loopback apiUrl (T20)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-timeline-push-bg tests..."
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)

T=$(cd "$(mktemp -d /tmp/oss-timeline-push-bg.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
# The hook runs through a link to this checkout's hooks folder under $T: its SCRIPT_DIR (pwd, not pwd -P) and so
# the detached push's command line carry $T, so the snapshot and reap can only match pushes this test started.
ln -s "$ROOT/hooks" "$T/hooks"; HOOK="$T/hooks/oss-timeline.sh"
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT
export CLAUDE_CODE_SESSION_ID=tpbg-session-1
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api-fake"; fake_api_install "$API"
export PATH="$API/bin:$PATH"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' 'fake-oss-key-timeline-push-bg-0042' > "$HOME/.oss/config.json"

# A machine with no perl: a sandbox COPY of the hooks in which oss-timeline.sh names a perl that does not exist
# (the hook runs /usr/bin/perl by absolute path, never a perl found on PATH, so PATH cannot hide it).
NOPERL=/nonexistent-oss-t/bin/perl
mkdir -p "$T/fallback"; cp "$ROOT"/hooks/*.sh "$T/fallback/"
sed "s#/usr/bin/perl#$NOPERL#g" "$ROOT/hooks/oss-timeline.sh" > "$T/fallback/oss-timeline.sh"
chmod 755 "$T/fallback/oss-timeline.sh"
NOPERL_HOOK="$T/fallback/oss-timeline.sh"

# the gate: loaded by every perl under the holder, it waits for the holder's snapshot (2 s at most)
mkdir -p "$T/plib"
cat > "$T/plib/OssTlGate.pm" <<'PM'
package OssTlGate;
BEGIN { my $m = $ENV{OSS_T_GATE}; if (defined $m && length $m) { for (1 .. 200) { last if -e $m; select(undef, undef, undef, 0.01) } } }
1;
PM

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
export CLAUDE_PROJECT_DIR="$P"
TL="$P/.oss/dev/active/demo/timeline.ndjson"
OB_DIR="$HOME/.oss/timeline-outbox"

# hold: with the hook $H, one waiting line, then a holder group (run_capped puts its command in a group of its own)
# runs `push --detach` and snapshots every process (pgid pid command) the instant it returns.
# -> $T/snap, $T/holder (the holder's pid = its group)
hold() {
    rm -rf "$API/api" "$OB_DIR" "$TL" "$T/snap" "$T/holder" "$T/released"; mkdir -p "$API/api"
    (cd "$P" && run_capped 20 "$H" command build start </dev/null >/dev/null 2>&1)
    (cd "$P" && FAKE_DELAY_TIMELINE=30 run_capped 30 /bin/bash -c '
        echo $$ > "$1/holder"
        PERL5LIB="$1/plib" PERL5OPT=-MOssTlGate OSS_T_GATE="$1/released" "$2" push --detach </dev/null >/dev/null 2>&1
        ps -A -o pgid=,pid=,command= > "$1/snap"
        : > "$1/released"' _ "$T" "$H" </dev/null >/dev/null 2>&1)
    G=$(cat "$T/holder" 2>/dev/null)
}
# in_group: the push's processes (perl or the hook) still in the holder's group at the snapshot
in_group() { awk -v g="$G" -v h="$H" '$1 == g && $2 != g && (index($0, h) || index($0, "perl"))' "$T/snap"; }
# pushes: "pgid pid" of each process of the detached push at the snapshot
pushes() { awk -v h="$H push" 'index($0, h) && !index($0, "awk") { print $1, $2 }' "$T/snap"; }
# own_group: every detached push process found is the leader of its own group, and there is at least one
own_group() { local n=0 g p; while read -r g p; do n=$((n + 1)); [[ "$g" == "$p" ]] || return 1; done < <(pushes); [[ $n -gt 0 ]]; }
# reap: kill the group of each push this test started (its pid from the snapshot, still running the hook)
reap() {
    local g p now
    while read -r g p; do
        now=$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')
        ps -o command= -p "$p" 2>/dev/null | grep -qF "$H" || continue
        if [[ "$now" == "$p" ]]; then kill -KILL -- "-$p" 2>/dev/null; else kill -KILL "$p" 2>/dev/null; fi
    done < <(pushes)
    rm -rf "$OB_DIR"
}

# the no-perl rows mean something only if the copy really has no perl to run
name='setup: the no-perl copy of oss-timeline.sh names no /usr/bin/perl, only a perl that does not exist'
[[ $(grep -c /usr/bin/perl "$NOPERL_HOOK") == 0 && $(grep -c "$NOPERL" "$NOPERL_HOOK") -gt 0 && ! -e "$NOPERL" \
    && $(grep -c /usr/bin/perl "$ROOT/hooks/oss-timeline.sh") -gt 0 ]] && pass "$name" \
    || fail "$name" "copy names /usr/bin/perl $(grep -c /usr/bin/perl "$NOPERL_HOOK") times, $NOPERL $(grep -c "$NOPERL" "$NOPERL_HOOK") times"

for how in perl no-perl; do
    if [[ $how == perl ]]; then H="$HOOK"; else H="$NOPERL_HOOK"; fi
    hold
    name="should leave nothing of the detached push in the caller's process group when push --detach returns ($how)"
    left=$(in_group)
    [[ -n "$G" && -s "$T/snap" && -z "$left" ]] && pass "$name" || fail "$name" "holder=$G still in its group: $(echo "$left" | cut -c1-160 | tr '\n' '|')"
    name="should have the detached push running, in a process group of its own, when push --detach returns ($how)"
    own_group && pass "$name" || fail "$name" "pgid/pid of the push at the snapshot: $(pushes | tr '\n' '|') (holder group $G)"
    reap
done

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
