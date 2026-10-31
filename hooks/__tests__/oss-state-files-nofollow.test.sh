#!/bin/bash
# The IRON LAWS state files in ~/.oss are read only when they are regular files, and written by replacing them.
#
# @behavior A FIFO at ~/.oss/team-iron-laws.json(.src), .team-iron-laws-backoff, .iron-laws-last-check or
#           .iron-laws-backoff never makes a prompt or a session start hang: the hooks never open it, treat it as
#           missing, and put a regular file in its place. A symlink at one of those paths is not trusted and is
#           not written through: the file it points to stays byte-identical (and keeps its mtime), and the path
#           becomes a regular file. A directory at the cache path leaves no temp file behind and the laws still print.
# @business-rule T32 (pen-test 4, 7; security F6): these files are read only when `-f` and not `-L` (checked
#           before any open) and written through a temp file in ~/.oss plus `mv -f` (oss_write_atomic).
# @boundary oss-fetch-team-iron-laws.sh and oss-iron-laws-sync.sh (system boundary); curl is the faked collaborator.
#
# A FIFO is never opened: a waiter blocks in open() on it (replacing the path later does not disturb it). A writer
# waiter ends when the hook opens the FIFO to read; a reader waiter ends when the hook opens it to write. A waiter
# still waiting after the run = never opened. Each run is capped (its process group is killed after 20 s), so a
# hook that does hang fails here instead of hanging the suite.
#
# Usage: ./hooks/__tests__/oss-state-files-nofollow.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-state-files-nofollow.test.sh  (mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
TEAM="$HOOKS/oss-fetch-team-iron-laws.sh"
SYNC="$HOOKS/oss-iron-laws-sync.sh"
source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running ~/.oss state-file nofollow tests..."

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
# One curl for both hooks, warmed once: a line per call in $SHIM/argv; the team endpoint gets a JSON config, the
# shared laws endpoint a laws body over the sync's 500-byte floor; status from $SHIM/code (default 200).
WARM=y
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
printf '%s\n' "$*" >> "$SHIM/argv"
cat > /dev/null
last=""; for a in "$@"; do last="$a"; done
case "$last" in
    (*/iron-laws/*) printf '{"law1_tdd":{"enabled":true,"locked":true},"from":"stub"}\n' ;;
    (*) printf '# IRON LAWS from stub\n'
       for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "IRON LAW padding line $i: a real laws body is several KB, the sync rejects anything under 500 bytes."; done ;;
esac
printf '%s' "$(cat "$SHIM/code" 2>/dev/null || echo 200)"
EOF
)" || WARM=n
[[ $WARM == y ]] || fail "curl stub warms up" "warm_stub returned non-zero"

URL="http://127.0.0.1:9"
SRC_URL="$URL/api/v1/iron-laws/defaults"
mtime_of() { perl -e 'print((lstat $ARGV[0])[9])' "$1"; }
new_case() { # a fresh sandbox: HOME with a config naming $URL, a project whose CLAUDE.md has one laws block
    C=$(mktemp -d "$KS/case.XXXXXX"); mkdir -p "$C/home/.oss" "$C/proj" "$C/outside/dir"
    printf '{"apiKey":"fake-key-K","apiUrl":"%s"}' "$URL" > "$C/home/.oss/config.json"
    printf '# P\n\n<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->\nold laws\n<!-- IRON LAWS END -->\n' > "$C/proj/CLAUDE.md"
    TL="$C/home/.oss/team-iron-laws.json"; SRCF="$TL.src"; TB="$C/home/.oss/.team-iron-laws-backoff"
    ST="$C/home/.oss/.iron-laws-last-check"; SB="$C/home/.oss/.iron-laws-backoff"
}
api_down() { printf 503 > "$C/code"; }
victim() { # victim <content>: $C/outside/victim holds <content>, 2 h old; VICTIM_MTIME records it
    printf '%s\n' "$1" > "$C/outside/victim"
    perl -e '$t = time - 7200; utime $t, $t, @ARGV' "$C/outside/victim"
    VICTIM_BODY="$1"; VICTIM_MTIME=$(mtime_of "$C/outside/victim")
}
victim_same() { [[ "$(cat "$C/outside/victim")" == "$VICTIM_BODY" && "$(mtime_of "$C/outside/victim")" == "$VICTIM_MTIME" ]]; }
regular() { [[ -f "$1" && ! -L "$1" ]]; }
run_hook() { # run_hook <hook> [args]: sandbox HOME, project $C/proj, the stub curl. Through run_capped: its own
    # process group, killed whole after 20 s, so a hook stuck on a FIFO, and the cat it started, never hang the suite.
    local hook="$1"; shift
    RC=0
    OUT=$(cd "$C/proj" && SHIM="$C" OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$C/home" CLAUDE_PROJECT_DIR="$C/proj" PATH="$KS/bin:$PATH" \
        run_capped 20 /bin/bash "$hook" "$@" </dev/null 2>&1) || RC=$?
    CALLS=0; [[ -f "$C/argv" ]] && CALLS=$(wc -l < "$C/argv" | tr -d ' ')
}
fifo_at() { # fifo_at <path> <r|w>: <path> is a FIFO; r = a writer waits on it (catches a read), w = a reader (catches a write)
    # The waiter marks $C/ready right before its open, and the hook starts only after that mark, so the waiter is
    # blocked on THIS FIFO when the hook runs (a hook replacing the path later cannot hand it a regular file).
    mkfifo "$1"; rm -f "$C/ready"
    perl -e 'my ($p, $d, $r) = @ARGV; open(my $m, ">", $r) or exit 2; close $m;
             my $fh; if ($d eq "r") { open($fh, ">", $p) } else { open($fh, "<", $p) } exit 0' "$1" "$2" "$C/ready" \
        </dev/null >/dev/null 2>&1 &
    WAITER=$!
    until [[ -e "$C/ready" ]] || ! kill -0 "$WAITER" 2>/dev/null; do :; done
}
never_opened() { # true when the waiter is still waiting; ends it either way
    local o=n; kill -0 "$WAITER" 2>/dev/null && o=y
    kill "$WAITER" 2>/dev/null; wait "$WAITER" 2>/dev/null
    [[ $o == y ]]
}
team_laws() { [[ $RC -eq 0 && "$OUT" == *'"from":"stub"'* ]]; }
sync_wrote() { [[ $RC -eq 0 ]] && grep -q 'IRON LAWS from stub' "$C/proj/CLAUDE.md"; }

for dir in r w; do
    [[ $dir == r ]] && how="opened to read" || how="opened to write"

    name="team: a FIFO at team-iron-laws.json.src is never $how, and becomes the regular source file"
    new_case; printf 'CACHED\n' > "$TL"; fifo_at "$SRCF" $dir; run_hook "$TEAM"
    if never_opened && team_laws && regular "$SRCF" && [[ "$(cat "$SRCF")" == "$SRC_URL" ]]; then pass "$name"
    else fail "$name" "rc=$RC calls=$CALLS out=$OUT src_regular=$(regular "$SRCF" && echo y || echo n)"; fi

    name="team: a FIFO at team-iron-laws.json is never $how, and becomes the regular cache"
    new_case; fifo_at "$TL" $dir; printf '%s\n' "$SRC_URL" > "$SRCF"; run_hook "$TEAM"
    if never_opened && team_laws && regular "$TL" && grep -q '"from":"stub"' "$TL"; then pass "$name"
    else fail "$name" "rc=$RC calls=$CALLS out=$OUT cache_regular=$(regular "$TL" && echo y || echo n)"; fi

    name="team: a FIFO at .team-iron-laws-backoff is never $how, is no backoff, and a failed fetch makes it a regular file"
    new_case; api_down; fifo_at "$TB" $dir; run_hook "$TEAM"
    if never_opened && [[ $RC -eq 0 && $CALLS == 1 ]] && regular "$TB"; then pass "$name"
    else fail "$name" "rc=$RC calls=$CALLS backoff_regular=$(regular "$TB" && echo y || echo n)"; fi

    name="sync: a FIFO at .iron-laws-last-check is never $how (no hang), and becomes the regular stamp"
    new_case; fifo_at "$ST" $dir; run_hook "$SYNC"
    if never_opened && sync_wrote && regular "$ST" && [[ "$(cat "$ST")" == "$URL" ]]; then pass "$name"
    else fail "$name" "rc=$RC calls=$CALLS out=$OUT stamp_regular=$(regular "$ST" && echo y || echo n)"; fi

    name="sync: a FIFO at .iron-laws-backoff is never $how, is no backoff, and a failed fetch makes it a regular file"
    new_case; api_down; fifo_at "$SB" $dir; run_hook "$SYNC"
    if never_opened && [[ $RC -eq 0 && $CALLS == 1 ]] && regular "$SB"; then pass "$name"
    else fail "$name" "rc=$RC calls=$CALLS backoff_regular=$(regular "$SB" && echo y || echo n)"; fi
done

name="team: a FIFO at .team-iron-laws-backoff is no backoff: the check asks the API"
new_case; fifo_at "$TB" r; run_hook "$TEAM"
if never_opened && team_laws && [[ $CALLS == 1 ]]; then pass "$name"; else fail "$name" "rc=$RC calls=$CALLS out=$OUT"; fi

# Symlinks: never trusted, never written through; the path becomes a regular file.
name="team: a symlinked .src holding the right URL is not trusted (a request), not written through, and replaced"
new_case; printf 'CACHED\n' > "$TL"; victim "$SRC_URL"; ln -s "$C/outside/victim" "$SRCF"; run_hook "$TEAM"
if team_laws && [[ $CALLS == 1 ]] && victim_same && regular "$SRCF" && [[ "$(cat "$SRCF")" == "$SRC_URL" ]]; then pass "$name"
else fail "$name" "rc=$RC calls=$CALLS out=$OUT victim=$(cat "$C/outside/victim") src_regular=$(regular "$SRCF" && echo y || echo n)"; fi

name="team: a symlinked team-iron-laws.json is not written through, and becomes the regular cache"
new_case; victim VICTIM; ln -s "$C/outside/victim" "$TL"; run_hook "$TEAM"
if team_laws && victim_same && regular "$TL" && grep -q '"from":"stub"' "$TL"; then pass "$name"
else fail "$name" "rc=$RC out=$OUT victim=$(cat "$C/outside/victim") cache_regular=$(regular "$TL" && echo y || echo n)"; fi

name="team: team-iron-laws.json symlinked to a directory: nothing lands in the directory, the path becomes the cache"
new_case; ln -s "$C/outside/dir" "$TL"; run_hook "$TEAM"
if team_laws && [[ -z "$(ls -A "$C/outside/dir")" ]] && regular "$TL"; then pass "$name"
else fail "$name" "rc=$RC out=$OUT dir=$(ls -A "$C/outside/dir" | tr '\n' ' ') cache_regular=$(regular "$TL" && echo y || echo n)"; fi

name="team: a symlinked .team-iron-laws-backoff is no backoff (a request), and a failed fetch replaces it, not its target"
new_case; api_down; victim VICTIM; ln -s "$C/outside/victim" "$TB"; run_hook "$TEAM"
if [[ $RC -eq 0 && $CALLS == 1 ]] && victim_same && regular "$TB"; then pass "$name"
else fail "$name" "rc=$RC calls=$CALLS victim_mtime=$(mtime_of "$C/outside/victim")/$VICTIM_MTIME backoff_regular=$(regular "$TB" && echo y || echo n)"; fi

name="sync: a symlinked stamp holding the right apiUrl is not trusted (a request), not written through, and replaced"
new_case; victim "$URL"; ln -s "$C/outside/victim" "$ST"; run_hook "$SYNC"
if sync_wrote && [[ $CALLS == 1 ]] && victim_same && regular "$ST" && [[ "$(cat "$ST")" == "$URL" ]]; then pass "$name"
else fail "$name" "rc=$RC calls=$CALLS out=$OUT victim=$(cat "$C/outside/victim") stamp_regular=$(regular "$ST" && echo y || echo n)"; fi

name="sync: a symlinked .iron-laws-backoff is no backoff (a request), and a failed fetch replaces it, not its target"
new_case; api_down; victim VICTIM; ln -s "$C/outside/victim" "$SB"; run_hook "$SYNC"
if [[ $RC -eq 0 && $CALLS == 1 ]] && victim_same && regular "$SB"; then pass "$name"
else fail "$name" "rc=$RC calls=$CALLS victim_mtime=$(mtime_of "$C/outside/victim")/$VICTIM_MTIME backoff_regular=$(regular "$SB" && echo y || echo n)"; fi

# A write that cannot land (a real directory at the path) leaves no temp file, and the laws still print.
name="team: a directory at team-iron-laws.json: the laws still print, exit 0, no temp file left anywhere"
new_case; mkdir "$TL"; run_hook "$TEAM"
if team_laws && [[ -z "$(ls -A "$TL")" && -z "$(find "$C/home/.oss" -name 'team-iron-laws.json.??????')" ]]; then pass "$name"
else fail "$name" "rc=$RC out=$OUT left=$(find "$C/home/.oss" | tr '\n' ' ')"; fi

# A write whose mv fails (an immutable cache file: rename over it is refused) removes its temp file. macOS chflags only.
if command -v chflags >/dev/null 2>&1; then
    name="team: the cache write fails at the mv (immutable cache): the laws still print, exit 0, no temp file left"
    new_case; printf 'OLD\n' > "$TL"; chflags uchg "$TL"; run_hook "$TEAM"; chflags nouchg "$TL"
    if team_laws && [[ "$(cat "$TL")" == OLD && -z "$(find "$C/home/.oss" -name 'team-iron-laws.json.??????')" ]]; then pass "$name"
    else fail "$name" "rc=$RC out=$OUT left=$(find "$C/home/.oss" | tr '\n' ' ')"; fi
fi

name="no temp file is left in any case's ~/.oss"
left=$(find "$KS" -path '*/home/.oss/*' -name '*.??????')
if [[ -z "$left" ]]; then pass "$name"; else fail "$name" "$left"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
