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
#           T18: the record is "<version>\n<plugin root>", written (temp + mv) only after every copy
#           succeeded, and trusted only as a regular, non-symlink file whose root still has that version.
#           T31: and only when that root is a user-owned, non-symlink directory whose plugin.json is a
#           user-owned regular non-symlink file (a FIFO is never opened), and the installed hooks are
#           byte-identical to that root's: the record must name the plugin the hooks really came from.
#           T36: every hook session start copies must exist on both sides; a root holding only some of
#           them (or an install missing one) is not trusted.
#
# Usage:   /bin/bash hooks/__tests__/session-start-no-hook-downgrade.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
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
# Session start runs under an alias (lib/session-start-alias.sh): an outside `pkill -f oss-session-start` misses it (T48).
source "$SCRIPT_DIR/lib/session-start-alias.sh"
SS_HOOK=$(session_start_alias "$(dirname "$SESSION_START")" "$KS/ss-alias/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
make_root() { # make_root <dir> <version|""> ; "" = no plugin.json
    mkdir -p "$KS/$1/hooks" "$KS/$1/.claude-plugin"
    [[ -n "$2" ]] && printf '{\n  "name": "oss",\n  "version": "%s"\n}\n' "$2" > "$KS/$1/.claude-plugin/plugin.json"
    local n; for n in $NAMES; do printf '# fake %s from %s\n' "$n" "$1" > "$KS/$1/hooks/$n"; done
}
for v in 2.0.83 2.0.94 2.0.95 2.0.99 2.0.100 2.1.0; do make_root "$v" "$v"; done
make_root noversion ""
make_root badversion '0+a[$(touch pwned)]'

seed() { # seed <version|""> [<root>] [<hooks from>] : a home whose hooks were installed by "someone else"
    # (<root>: record line 2). The installed hooks are copies of <hooks from> (default <root>) when that
    # root exists, as a real install leaves them (T31); "" or a missing root seeds placeholder text.
    T=$(mktemp -d "$KS/case.XXXXXX"); mkdir -p "$T/home/.oss/hooks"
    local n from=${3-${2:-}}
    for n in $NAMES; do
        if [[ -n "$from" && -f "$KS/$from/hooks/$n" ]]; then cp "$KS/$from/hooks/$n" "$T/home/.oss/hooks/$n"
        else printf '# seeded %s\n' "$n" > "$T/home/.oss/hooks/$n"; fi
    done
    printf '# seeded legacy statusline\n' > "$T/home/.oss/oss-statusline.sh"
    printf '/seeded/plugin/root\n' > "$T/home/.oss/plugin-root"
    [[ -n "$1" ]] && printf '%s\n' "$1" > "$T/home/.oss/hooks/.installed-version"
    [[ -n "${2:-}" ]] && printf '%s\n' "$KS/$2" >> "$T/home/.oss/hooks/.installed-version"
    snapshot > "$T/before"
}
snapshot() { (cd "$T/home/.oss" && for f in hooks/* hooks/.installed-version oss-statusline.sh plugin-root; do [[ -f "$f" ]] && cksum "$f"; done) }
run_from() { # run_from <root> : session start, sandbox HOME, no config (no key, no network); 3>&1 waits for detached jobs
    out=$(cd "$T" && env -u CLAUDE_PROJECT_DIR -u OSS_CONFIG_DIR -u OSS_MANIFEST_URL -u OSS_ALLOW_HTTP_LOOPBACK -u CLAUDE_CODE_SESSION_ID \
        HOME="$T/home" CLAUDE_PLUGIN_ROOT="$KS/$1" OSS_SKIP_HEALTH_CHECK=1 \
        perl -e 'alarm 30; exec @ARGV' /bin/bash "$SS_HOOK" </dev/null 2>&1 3>&1)
}
# Only a regular file is read: the FIFO case would block a failure message forever.
record() { [[ -f "$T/home/.oss/hooks/.installed-version" ]] && cat "$T/home/.oss/hooks/.installed-version" 2>/dev/null; }
plugin_root() { cat "$T/home/.oss/plugin-root" 2>/dev/null; }   # T18 (4): written only with the hooks
rec_of() { printf '%s\n%s' "$1" "$KS/$2"; }   # rec_of <version> <root>: a record as record() prints it
installed_from() { # every copied file (and the legacy statusline) equals <root>'s
    local n; for n in $NAMES; do cmp -s "$KS/$1/hooks/$n" "$T/home/.oss/hooks/$n" || return 1; done
    cmp -s "$KS/$1/hooks/oss-statusline.sh" "$T/home/.oss/oss-statusline.sh"
}
unchanged() { snapshot | cmp -s - "$T/before"; }

check_refused() { # check_refused <label> <record version> <root> : the record names the live root of that version
    # unchanged covers ~/.oss/plugin-root too: the shared hooks and the root they use come from one plugin
    seed "$2" "$2"; run_from "$3"
    if unchanged; then pass "$1"; else fail "$1" "shared hooks or record changed (record now '$(record)')"; fi
}
check_copied() { # check_copied <label> <record version> <root> <expected version after|""> [<record root>, default the root of that version] [<installed hooks from>, default the record root]
    seed "$2" "${5-$2}" "${6-${5-$2}}"; run_from "$3"
    local want=""; [[ -n "$4" ]] && want=$(rec_of "$4" "$3")
    if installed_from "$3" && [[ "$(record)" == "$want" && "$(plugin_root)" == "$KS/$3" ]]; then pass "$1"
    else fail "$1" "installed_from=$(installed_from "$3" && echo y || echo n) record='$(record)' want '$want' plugin-root='$(plugin_root)'"; fi
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
check_copied "non-numeric record counts as no record: installs and rewrites it" '0+a[$(touch pwned)]' 2.0.83 2.0.83 ""
if [[ -z "$(find "$KS" -name pwned)" ]]; then pass "a version string is never evaluated"; else fail "a version string is never evaluated" "pwned file created"; fi

# T18 (1): the record is written only after every copy succeeded, and by replacing the file (temp in the
# same dir + mv), never by writing into whatever is at its path.
make_root partial 2.0.95; LAST_NAME=$(printf '%s\n' $NAMES | tail -1); chmod 000 "$KS/partial/hooks/$LAST_NAME"
[[ -r "$KS/partial/hooks/$LAST_NAME" ]] && fail "fixture: a copy can be made to fail" "an unreadable file is still readable (running as root?)"
seed ""; run_from partial
if [[ ! -e "$T/home/.oss/hooks/.installed-version" ]]; then pass "a failed copy writes no record"
else fail "a failed copy writes no record" "record '$(record)'"; fi
seed 2.0.83 2.0.83; run_from partial
if [[ "$(record)" == "$(rec_of 2.0.83 2.0.83)" ]]; then pass "a failed copy leaves the old record"
else fail "a failed copy leaves the old record" "record '$(record)'"; fi
seed 2.0.83 2.0.83; rec_of 2.0.83 2.0.83 > "$T/outside"; rm -f "$T/home/.oss/hooks/.installed-version"
ln "$T/outside" "$T/home/.oss/hooks/.installed-version"; run_from 2.0.95
if [[ "$(record)" == "$(rec_of 2.0.95 2.0.95)" && "$(cat "$T/outside")" == "$(rec_of 2.0.83 2.0.83)" ]]; then pass "the record is replaced, not written through (hard link)"
else fail "the record is replaced, not written through (hard link)" "record '$(record)' outside '$(cat "$T/outside")'"; fi
if [[ -z "$(find "$KS" -name '.installed-version.*')" ]]; then pass "no temp record is left behind"
else fail "no temp record is left behind" "$(find "$KS" -name '.installed-version.*')"; fi

# T18 (2): a record is trusted only when it is a regular file, not a symlink. A FIFO, a directory or a
# symlink at its path counts as no record: the plugin copies and puts a regular record in its place.
# A FIFO is never opened: a writer waits on it the whole run, so a read that opened it would get EOF
# (no hang) and end the writer, which is how the test sees it (the writer still waiting = never opened).
REC_PATH() { printf '%s' "$T/home/.oss/hooks/.installed-version"; }
regular_record() { [[ -f "$(REC_PATH)" && ! -L "$(REC_PATH)" && "$(record)" == "$1" ]]; }
seed ""; mkfifo "$(REC_PATH)"
( exec 4>"$(REC_PATH)" ) </dev/null >/dev/null 2>&1 & WRITER=$!
run_from 2.0.95
if kill -0 "$WRITER" 2>/dev/null; then never_opened=y; else never_opened=n; fi
kill "$WRITER" 2>/dev/null; wait "$WRITER" 2>/dev/null
if [[ $never_opened == y ]] && installed_from 2.0.95 && regular_record "$(rec_of 2.0.95 2.0.95)"; then pass "a FIFO record is never opened, counts as no record, and is replaced"
else fail "a FIFO record is never opened, counts as no record, and is replaced" "never_opened=$never_opened installed_from=$(installed_from 2.0.95 && echo y || echo n) record='$(record)'"; fi
seed ""; mkdir "$(REC_PATH)"; run_from 2.0.95
if installed_from 2.0.95 && regular_record "$(rec_of 2.0.95 2.0.95)"; then pass "a directory record counts as no record and is replaced by a file"
else fail "a directory record counts as no record and is replaced by a file" "installed_from=$(installed_from 2.0.95 && echo y || echo n) dir=$([[ -d $(REC_PATH) ]] && echo y || echo n)"; fi
seed ""; rec_of 2.0.100 2.0.100 > "$T/target"; ln -s "$T/target" "$(REC_PATH)"; run_from 2.0.95
if installed_from 2.0.95 && regular_record "$(rec_of 2.0.95 2.0.95)" && [[ "$(cat "$T/target")" == "$(rec_of 2.0.100 2.0.100)" ]]; then pass "a symlinked record is not trusted, not written through, and is replaced"
else fail "a symlinked record is not trusted, not written through, and is replaced" "installed_from=$(installed_from 2.0.95 && echo y || echo n) link=$([[ -L $(REC_PATH) ]] && echo y || echo n) target='$(cat "$T/target")'"; fi

# T18 (3): the record names the plugin root that wrote it (line 2). A newer record counts only while that
# root still has that version, so uninstalling or rolling back the newer plugin (or planting a high
# record) never freezes the shared hooks. A one-line record (only this unreleased 2.0.95 wrote one) has
# no root: untrusted, so the plugin copies.
check_copied "newer record whose plugin is gone: the older plugin installs" 2.0.100 2.0.95 2.0.95 gone
check_copied "newer record whose plugin was rolled back to 2.0.83: the older plugin installs" 2.0.100 2.0.95 2.0.95 2.0.83
check_copied "one-line newer record (no root): untrusted, the plugin installs" 2.0.100 2.0.95 2.0.95 ""

# T18 (5): the version is the top-level "version" of plugin.json (a nested key never wins); a prerelease
# compares as its numeric core (2.1.0-beta.1 as 2.1.0); a part longer than 9 digits is unreadable (bash
# arithmetic would overflow it).
make_root nested ""
printf '{\n  "name": "oss",\n  "engines": {\n    "version": "9.9.9"\n  },\n  "version": "2.0.83"\n}\n' > "$KS/nested/.claude-plugin/plugin.json"
check_refused "a nested \"version\" key (9.9.9) is not the plugin version (2.0.83)" 2.0.94 nested
check_copied "the top-level version is read past a nested one (2.0.83 over 2.0.83)" 2.0.83 nested 2.0.83 2.0.83
make_root 2.1.0-beta.1 2.1.0-beta.1
check_copied "a prerelease (2.1.0-beta.1) compares as 2.1.0: installs over 2.0.100" 2.0.100 2.1.0-beta.1 2.1.0
check_refused "a 2.1.0-beta.1 install is not replaced by 2.0.100" 2.1.0-beta.1 2.0.100
make_root 2.0.1234567890 2.0.1234567890
check_refused "a version part longer than 9 digits is unreadable" 2.0.94 2.0.1234567890

# T31: a newer record counts only when it names the plugin the installed hooks really came from: its root
# is a user-owned directory (not a symlink), its plugin.json a user-owned regular file (not a symlink, so a
# FIFO is never opened and session start never hangs), and every installed hook this plugin copies is
# byte-identical to that root's copy. Anything else: the current plugin installs, as with no record.
# (Not covered: a root or plugin.json owned by another user; that needs sudo to arrange.)
check_refused "real case: 2.0.100 really installed, then a 2.0.95 session is refused" 2.0.100 2.0.95
T=$(mktemp -d "$KS/case.XXXXXX"); mkdir -p "$T/home"; run_from 2.0.100; snapshot > "$T/before"; run_from 2.0.95
if unchanged && [[ "$(record)" == "$(rec_of 2.0.100 2.0.100)" ]]; then pass "end to end: a 2.0.100 session installs, a later 2.0.95 session leaves it"
else fail "end to end: a 2.0.100 session installs, a later 2.0.95 session leaves it" "record '$(record)'"; fi

make_root fake 9.9.9
check_copied "a planted record naming a fake 9.9.9 root whose hooks differ from the installed ones: installs" 9.9.9 2.0.95 2.0.95 fake 2.0.94
make_root empty 9.9.9; rm -f "$KS/empty/hooks/"*
check_copied "a planted record naming a 9.9.9 root with no hooks at all: installs" 9.9.9 2.0.95 2.0.95 empty 2.0.94
make_root lastdiff 9.9.9
seed 9.9.9 lastdiff; printf '# not from lastdiff\n' > "$T/home/.oss/hooks/$LAST_NAME"; run_from 2.0.95
if installed_from 2.0.95 && [[ "$(record)" == "$(rec_of 2.0.95 2.0.95)" ]]; then pass "one installed hook (the last) differing from the record's root: installs"
else fail "one installed hook (the last) differing from the record's root: installs" "record '$(record)'"; fi

# T36 (pen-test r3 #4): every hook this plugin copies must be in the root AND installed, and identical. A
# root holding only some of them proves nothing about the rest: a modified installed hook it lacks would
# survive the update.
make_root onehook 9.9.9; FIRST_NAME=$(printf '%s\n' $NAMES | head -1); rm -f "$KS/onehook/hooks/"*
cp "$KS/2.0.94/hooks/$FIRST_NAME" "$KS/onehook/hooks/$FIRST_NAME"
check_copied "a planted 9.9.9 root holding one hook identical to the installed one: installs" 9.9.9 2.0.95 2.0.95 onehook 2.0.94
make_root misslast 9.9.9; rm -f "$KS/misslast/hooks/$LAST_NAME"
check_copied "a 9.9.9 root missing only the last hook (the rest identical): installs" 9.9.9 2.0.95 2.0.95 misslast
make_root instmiss 9.9.9
seed 9.9.9 instmiss; rm -f "$T/home/.oss/hooks/$LAST_NAME"; run_from 2.0.95
if installed_from 2.0.95 && [[ "$(record)" == "$(rec_of 2.0.95 2.0.95)" ]]; then pass "an installed side missing a hook the record's root has: installs"
else fail "an installed side missing a hook the record's root has: installs" "record '$(record)'"; fi

ln -s "$KS/2.0.100" "$KS/linkroot"
check_copied "a record whose root is a symlink (to a real 2.0.100 root): installs" 2.0.100 2.0.95 2.0.95 linkroot 2.0.100
make_root linkjson ""; cp "$KS/2.0.100/hooks/"* "$KS/linkjson/hooks/"
ln -s "$KS/2.0.100/.claude-plugin/plugin.json" "$KS/linkjson/.claude-plugin/plugin.json"
check_copied "a record whose root's plugin.json is a symlink: installs" 2.0.100 2.0.95 2.0.95 linkjson linkjson
make_root dirjson ""; mkdir "$KS/dirjson/.claude-plugin/plugin.json"
check_copied "a record whose root's plugin.json is a directory: installs" 2.0.100 2.0.95 2.0.95 dirjson dirjson

# FIFOs: a writer waits on each the whole run, so a read that opened one would get EOF (no hang) and end
# the writer; the writer still waiting afterwards = never opened. Without a writer, opening one hangs.
fifo_case() { # fifo_case <label> <fifo path under $KS/fiforoot> ; record 2.0.100 names fiforoot
    rm -rf "$KS/fiforoot"; make_root fiforoot 2.0.100; cp "$KS/2.0.100/hooks/"* "$KS/fiforoot/hooks/"
    seed 2.0.100 fiforoot
    rm -f "$KS/fiforoot/$2"; mkfifo "$KS/fiforoot/$2"
    ( exec 4>"$KS/fiforoot/$2" ) </dev/null >/dev/null 2>&1 & local w=$! opened=y
    run_from 2.0.95
    kill -0 "$w" 2>/dev/null && opened=n
    kill "$w" 2>/dev/null; wait "$w" 2>/dev/null
    if [[ $opened == n ]] && installed_from 2.0.95 && [[ "$(record)" == "$(rec_of 2.0.95 2.0.95)" ]]; then pass "$1"
    else fail "$1" "opened=$opened installed_from=$(installed_from 2.0.95 && echo y || echo n) record='$(record)'"; fi
}
fifo_case "a record whose root's plugin.json is a FIFO: never opened, installs" .claude-plugin/plugin.json
fifo_case "a record whose root has a FIFO hook: never opened, installs" "hooks/$LAST_NAME"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
