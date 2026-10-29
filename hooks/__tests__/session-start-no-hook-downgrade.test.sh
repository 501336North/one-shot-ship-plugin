#!/bin/bash
# Session start never downgrades the machine-global ~/.oss/hooks (T17, behavioural).
#
# @behavior A session whose plugin is older than the one that last installed ~/.oss/hooks leaves those
#           hooks (and the legacy ~/.oss/oss-statusline.sh) byte-identical; a session on the same or a
#           newer plugin installs its own copies and records its version in ~/.oss/hooks/.installed-version.
# @business-rule ~/.oss/hooks is shared by every session on the machine, so the newest installed plugin
#           owns it. On 2026-10-29 a 2.0.83 session replaced the 2.0.94 hooks and every session ran old
#           code. Versions compare numerically per dot part (2.0.100 > 2.0.95, 2.1.0 > 2.0.99).
#           No record (first install, or hooks from before this rule): copy, as before.
#           This plugin's version unreadable: it cannot prove it is not older, so it does not overwrite a
#           recorded install; with no record it copies (as before) and writes no record.
#           The legacy ~/.oss/oss-statusline.sh comes from the same plugin root in the same step, so it
#           follows the same rule.
#
# Usage:   /bin/bash hooks/__tests__/session-start-no-hook-downgrade.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_START="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/oss-session-start.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN+1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN+1)); FAILED=$((FAILED+1)); }

# The files session start copies, read from the hook under test so the fixture never drifts from it.
NAMES=$(sed -n '/^HOOKS_TO_COPY=(/,/^)/p' "$SESSION_START" | grep -o '"[^"]*"' | tr -d '"')
[[ -n "$NAMES" ]] || { echo "✗ FAIL: could not read HOOKS_TO_COPY from $SESSION_START"; exit 1; }

# Fake plugin roots, made once: plain data files (cp never execs them, so no first-exec scan cost).
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
make_root() { # make_root <dir> <version|""> ; "" = no plugin.json
    mkdir -p "$KS/$1/hooks" "$KS/$1/.claude-plugin"
    [[ -n "$2" ]] && printf '{\n  "name": "oss",\n  "version": "%s"\n}\n' "$2" > "$KS/$1/.claude-plugin/plugin.json"
    local n; for n in $NAMES; do printf '# fake %s from %s\n' "$n" "$1" > "$KS/$1/hooks/$n"; done
}
for v in 2.0.83 2.0.95 2.0.100 2.1.0; do make_root "$v" "$v"; done
make_root noversion ""
make_root badversion '0+a[$(touch pwned)]'

seed() { # seed <record|""> : a home whose hooks were installed by "someone else"
    T=$(mktemp -d "$KS/case.XXXXXX"); mkdir -p "$T/home/.oss/hooks"
    local n; for n in $NAMES; do printf '# seeded %s\n' "$n" > "$T/home/.oss/hooks/$n"; done
    printf '# seeded legacy statusline\n' > "$T/home/.oss/oss-statusline.sh"
    [[ -n "$1" ]] && printf '%s\n' "$1" > "$T/home/.oss/hooks/.installed-version"
    snapshot > "$T/before"
}
snapshot() { (cd "$T/home/.oss" && for f in hooks/* hooks/.installed-version oss-statusline.sh; do [[ -f "$f" ]] && cksum "$f"; done) }
run_from() { # run_from <root> : session start, sandbox HOME, no config (no key, no network); 3>&1 waits for detached jobs
    out=$(cd "$T" && env -u CLAUDE_PROJECT_DIR -u OSS_CONFIG_DIR -u CLAUDE_CODE_SESSION_ID \
        HOME="$T/home" CLAUDE_PLUGIN_ROOT="$KS/$1" OSS_SKIP_HEALTH_CHECK=1 \
        perl -e 'alarm 30; exec @ARGV' /bin/bash "$SESSION_START" </dev/null 2>&1 3>&1)
}
record() { cat "$T/home/.oss/hooks/.installed-version" 2>/dev/null; }
installed_from() { # every copied file (and the legacy statusline) equals <root>'s
    local n; for n in $NAMES; do cmp -s "$KS/$1/hooks/$n" "$T/home/.oss/hooks/$n" || return 1; done
    cmp -s "$KS/$1/hooks/oss-statusline.sh" "$T/home/.oss/oss-statusline.sh"
}
unchanged() { snapshot | cmp -s - "$T/before"; }

check_refused() { # check_refused <label> <record> <root>
    seed "$2"; run_from "$3"
    if unchanged; then pass "$1"; else fail "$1" "shared hooks or record changed (record now '$(record)')"; fi
}
check_copied() { # check_copied <label> <record> <root> <expected record after>
    seed "$2"; run_from "$3"
    if installed_from "$3" && [[ "$(record)" == "$4" ]]; then pass "$1"
    else fail "$1" "installed_from=$(installed_from "$3" && echo y || echo n) record='$(record)' want '$4'"; fi
}

# The incident, and numeric ordering where text ordering is wrong.
check_refused "older session (2.0.83) leaves 2.0.94 hooks and record untouched" 2.0.94 2.0.83
check_refused "2.0.95 session does not overwrite 2.0.100 hooks (numeric, not text, compare)" 2.0.100 2.0.95
check_refused "unreadable plugin version does not overwrite a recorded install" 2.0.94 noversion
# Controls: the guard must not stop a legitimate install.
check_copied "same version (2.0.95) reinstalls" 2.0.95 2.0.95 2.0.95
check_copied "newer session (2.0.100 over 2.0.95) installs and updates the record" 2.0.95 2.0.100 2.0.100
check_copied "2.1.0 over 2.0.99 installs (minor part outranks patch)" 2.0.99 2.1.0 2.1.0
check_copied "no record: installs as before and writes the record" "" 2.0.83 2.0.83
check_copied "no record and unreadable version: installs as before, writes no record" "" noversion ""
# A version is only ever read as dot-separated digits: anything else counts as unreadable / no record,
# and never reaches bash arithmetic (where a[$(...)] would run; run_from's cwd is the case dir).
check_refused "non-numeric plugin version counts as unreadable" 2.0.94 badversion
check_copied "non-numeric record counts as no record: installs and rewrites it" '0+a[$(touch pwned)]' 2.0.83 2.0.83
if [[ -z "$(find "$KS" -name pwned)" ]]; then pass "a version string is never evaluated"; else fail "a version string is never evaluated" "pwned file created"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
