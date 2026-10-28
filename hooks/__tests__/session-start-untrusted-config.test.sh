#!/bin/bash
# Session start with an OSS config the shared reader refuses (ship round 4, UR4).
#
# @behavior When ~/.oss/config.json exists but may not be read (a symlink, another owner, or writable by others),
#           each session-start hook says so in ONE line that names /oss:login, sends no key anywhere, and still runs
#           the rest of session start (its Ready line, permissions setup), as it did before keys were read
#           through the trust check (TR9). A trusted config behaves as before (control).
# @business-rule A refused config must never cost the user their session setup, and must never be silently read as
#           "not logged in": the user is told what is wrong and how to fix it.
# @boundary curl is a recorder (no network); the plugin root is a temp copy of hooks/ with a recording
#           oss-setup-permissions.sh and no watcher; HOME is a temp directory.
#
# Usage: ./hooks/__tests__/session-start-untrusted-config.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# One plugin root and one curl recorder for the whole file: the first run of a freshly copied script can stall for
# seconds on a loaded machine, so the copies are made once, not per case.
W=$(mktemp -d); W=$(cd "$W" && pwd -P); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/root/hooks" "$W/bin"
cp "$ROOT"/hooks/*.sh "$W/root/hooks/" 2>/dev/null
printf '#!/bin/bash\ntouch "$OSS_TEST_DIR/permissions-ran"\n' > "$W/root/hooks/oss-setup-permissions.sh"
printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "$OSS_TEST_DIR/curl-argv"\ncat >> "$OSS_TEST_DIR/curl-stdin" 2>/dev/null\nprintf "{\\"status\\":\\"active\\"}"\n' > "$W/bin/curl"
chmod +x "$W/root/hooks/"*.sh "$W/bin/curl"

setup() {  # setup <config kind: trusted | world-writable | symlink>
    T=$(mktemp -d "$W/case.XXXXXX")
    mkdir -p "$T/home/.oss" "$T/proj"
    chmod 700 "$T/home/.oss"
    case "$1" in
        trusted) printf '{"apiKey":"k-secret"}' > "$T/home/.oss/config.json"; chmod 600 "$T/home/.oss/config.json" ;;
        world-writable) printf '{"apiKey":"k-secret"}' > "$T/home/.oss/config.json"; chmod 666 "$T/home/.oss/config.json" ;;
        symlink) printf '{"apiKey":"k-secret"}' > "$T/elsewhere.json"; chmod 600 "$T/elsewhere.json"; ln -s "$T/elsewhere.json" "$T/home/.oss/config.json" ;;
    esac
}
run_hook() {  # run_hook <hook file>: sets OUT, RC (the alarm only guards against a hang)
    OUT=$(cd "$T/proj" && env -u OSS_CONFIG_DIR HOME="$T/home" CLAUDE_PLUGIN_ROOT="$W/root" CLAUDE_PROJECT_DIR="$T/proj" \
        OSS_TEST_DIR="$T" OSS_SKIP_HEALTH_CHECK=1 OSS_SKIP_WATCHER=1 PATH="$W/bin:$PATH" \
        perl -e 'alarm 120; exec @ARGV' bash "$W/root/hooks/$1" </dev/null 2>&1); RC=$?
}

for hook in oss-session-start.sh oss-session-start-new.sh oss-session-start-test.sh; do
    for kind in world-writable symlink; do
        setup "$kind"; run_hook "$hook"
        lines=$(printf '%s\n' "$OUT" | grep -ciE 'untrusted')
        line=$(printf '%s\n' "$OUT" | grep -iE 'untrusted' | head -n 1)
        sent=n; grep -q 'k-secret' "$T/curl-stdin" "$T/curl-argv" 2>/dev/null && sent=y
        rest=n; [[ "$OUT" == *"OSS: Ready"* ]] && rest=y
        perms=y; [[ "$hook" == oss-session-start.sh && ! -e "$T/permissions-ran" ]] && perms=n
        if [[ "$lines" == 1 && "$line" == *"/oss:login"* && "$OUT" != *"No API key found"* && "$OUT" != *"Not logged in"* \
              && $sent == n && $rest == y && $perms == y ]]; then
            pass "$hook, $kind config: one 'untrusted … /oss:login' line, no key sent, session start continues"
        else
            fail "$hook, $kind config" "untrusted lines=$lines sent=$sent rest=$rest permissions=$perms rc=$RC out: $OUT"
        fi
        rm -rf "$T"
    done
    # Control: a trusted config says nothing about trust and still sets the session up.
    setup trusted; run_hook "$hook"
    rest=n; [[ "$OUT" == *"OSS: Ready"* ]] && rest=y
    perms=y; [[ "$hook" == oss-session-start.sh && ! -e "$T/permissions-ran" ]] && perms=n
    if [[ "$OUT" != *ntrusted* && $rest == y && $perms == y ]]; then pass "$hook, trusted config: no trust warning, session start runs"
    else fail "$hook, trusted config" "rest=$rest permissions=$perms out: $OUT"; fi
    rm -rf "$T"
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
