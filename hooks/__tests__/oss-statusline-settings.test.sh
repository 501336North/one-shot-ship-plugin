#!/bin/bash
# /oss:login turns on the OSS status line through ~/.oss/hooks/oss-statusline-settings.sh (R-266).
#
# @behavior A user runs /oss:login and their Claude Code status line shows the OSS workflow state: the hook
#           merges {"statusLine":{"type":"command","command":"~/.oss/oss-statusline.sh","padding":0}} into
#           ~/.claude/settings.json and keeps every other setting they had. Running it again changes nothing.
# @business-rule The user's Claude Code settings are never lost or corrupted: a file that is not valid JSON
#           is left untouched (with a clear message), the write is atomic (no half-written file), the
#           file's mode is kept (0600 when new), and a settings.json or ~/.claude that is a symlink is
#           refused, so the write never lands somewhere else. Without jq nothing is written.
# @business-rule (R-266 round 12, SEC LOW-A, CR M2, CR I2) The hook writes only into the real user's own
#           ~/.claude: HOME must match the password database, or nothing is written. jq comes from a fixed
#           PATH, never one the caller chose. The file mode is read with BSD or GNU stat. An empty
#           settings.json counts as {}.
#
# Test seam (honest option, CR I2): the hook asks the password database (/usr/bin/id -P or getent) for
# the home and resets PATH itself, so a temp HOME is refused by the real hook (case 9 runs the real hook).
# The other cases run a COPY of the hook in which exactly one marked line is swapped: the password-home
# line (to the temp HOME), the PATH line (case 7: a PATH with no jq) or the stat line (case 10: a GNU-style
# stat stub). Each swap is checked to have matched, so the copy differs from the hook only there.
#
# Usage: ./hooks/__tests__/oss-statusline-settings.test.sh   (needs jq; uses a temp HOME only)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-statusline-settings.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WANT='{"type":"command","command":"~/.oss/oss-statusline.sh","padding":0}'
mode_of() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1" 2>/dev/null; }
# A copy of the hook with marked lines swapped: copy_hook <name> <marker> <replacement> [<marker> <replacement>]...
copy_hook() {
    local name="$1"; shift
    local out="$TMP/$name.sh"; cp "$HOOK" "$out"
    while [[ $# -ge 2 ]]; do
        local marker="$1" repl="$2"; shift 2
        grep -q -- "# seam: $marker\$" "$out" || { echo "seam '$marker' not found in the hook" >&2; return 1; }
        local tmpf="$out.tmp"
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" == *"# seam: $marker" ]]; then printf '%s # seam: %s\n' "$repl" "$marker"; else printf '%s\n' "$line"; fi
        done < "$out" > "$tmpf" && mv "$tmpf" "$out"
    done
    chmod +x "$out"; printf '%s' "$out"
}
TESTHOOK="$(copy_hook seamed pw-home 'PW_HOME="$HOME"')" || { echo "could not make the seamed copy"; exit 1; }
run_hook() { HOME="$1" PATH="${2:-/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin}" "${3:-$TESTHOOK}" </dev/null 2>&1; }

[[ -x "$HOOK" ]] || { fail "the hook exists and is executable" "missing: $HOOK"; echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; exit 1; }

# 1. No ~/.claude at all: created, settings.json holds only the status line, mode 600.
H="$TMP/h1"; mkdir -p "$H"
out="$(run_hook "$H")"; rc=$?
S="$H/.claude/settings.json"
if [[ $rc == 0 && "$(jq -c '.statusLine' "$S" 2>/dev/null)" == "$WANT" && "$(jq -c 'keys' "$S")" == '["statusLine"]' ]]; then pass "no ~/.claude: the folder and settings.json are created with the status line"
else fail "no ~/.claude: the folder and settings.json are created with the status line" "rc=$rc out=$out file=$(cat "$S" 2>&1)"; fi
if [[ "$(mode_of "$S")" == 600 ]]; then pass "a new settings.json is private (mode 600)"
else fail "a new settings.json is private (mode 600)" "mode=$(mode_of "$S")"; fi

# 2. Existing settings: every other key kept, an old statusLine replaced, mode kept.
H="$TMP/h2"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"
printf '{"model":"opus","permissions":{"allow":["WebSearch"]},"statusLine":{"type":"command","command":"old.sh"}}\n' > "$S"
chmod 644 "$S"
out="$(run_hook "$H")"; rc=$?
if [[ $rc == 0 && "$(jq -c '.statusLine' "$S")" == "$WANT" && "$(jq -r '.model' "$S")" == opus && "$(jq -c '.permissions' "$S")" == '{"allow":["WebSearch"]}' ]]; then pass "existing settings: other keys kept, the status line set"
else fail "existing settings: other keys kept, the status line set" "rc=$rc out=$out file=$(cat "$S")"; fi
if [[ "$(mode_of "$S")" == 644 ]]; then pass "the existing file's mode is kept (644)"
else fail "the existing file's mode is kept (644)" "mode=$(mode_of "$S")"; fi
if [[ -z "$(ls -A "$H/.claude" | grep -v '^settings.json$')" ]]; then pass "atomic write: no temp file left beside settings.json"
else fail "atomic write: no temp file left beside settings.json" "$(ls -A "$H/.claude")"; fi

# 3. Idempotent: a second run gives the same bytes.
before="$(cksum < "$S")"
run_hook "$H" >/dev/null; rc=$?
if [[ $rc == 0 && "$(cksum < "$S")" == "$before" ]]; then pass "a second run leaves the same bytes"
else fail "a second run leaves the same bytes" "rc=$rc"; fi

# 4. Invalid JSON: refused, non-zero, file untouched.
H="$TMP/h4"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"
printf '{"model": "opus",\n' > "$S"; before="$(cksum < "$S")"
out="$(run_hook "$H")"; rc=$?
if [[ $rc != 0 && "$(cksum < "$S")" == "$before" && "$out" == *"not valid JSON"* ]]; then pass "invalid JSON: refused with a clear message, the file untouched"
else fail "invalid JSON: refused with a clear message, the file untouched" "rc=$rc out=$out"; fi

# 5. settings.json is a symlink: refused, the target untouched.
H="$TMP/h5"; mkdir -p "$H/.claude" "$TMP/elsewhere"; printf '{"a":1}\n' > "$TMP/elsewhere/target.json"
ln -s "$TMP/elsewhere/target.json" "$H/.claude/settings.json"
out="$(run_hook "$H")"; rc=$?
if [[ $rc != 0 && "$(cat "$TMP/elsewhere/target.json")" == '{"a":1}' && -L "$H/.claude/settings.json" && "$out" == *symlink* ]]; then pass "settings.json is a symlink: refused, the link target untouched"
else fail "settings.json is a symlink: refused, the link target untouched" "rc=$rc out=$out target=$(cat "$TMP/elsewhere/target.json")"; fi

# 6. ~/.claude is a symlink: refused, nothing written there.
H="$TMP/h6"; mkdir -p "$H" "$TMP/elsedir"; ln -s "$TMP/elsedir" "$H/.claude"
out="$(run_hook "$H")"; rc=$?
if [[ $rc != 0 && -z "$(ls -A "$TMP/elsedir")" && "$out" == *symlink* ]]; then pass "~/.claude is a symlink: refused, nothing written"
else fail "~/.claude is a symlink: refused, nothing written" "rc=$rc out=$out dir=$(ls -A "$TMP/elsedir")"; fi

# 7. No jq: a clear message, nothing written.
H="$TMP/h7"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"; printf '{"a":1}\n' > "$S"
NOJQ="$TMP/nojq"; mkdir -p "$NOJQ"   # a PATH with no jq on it
NOJQHOOK="$(copy_hook nojq pw-home 'PW_HOME="$HOME"' path "PATH='$NOJQ'")" || { echo "could not make the no-jq copy"; exit 1; }
out="$(run_hook "$H" "$NOJQ" "$NOJQHOOK")"; rc=$?
if [[ $rc != 0 && "$(cat "$S")" == '{"a":1}' && "$out" == *jq* ]]; then pass "no jq: a clear message, nothing written"
else fail "no jq: a clear message, nothing written" "rc=$rc out=$out file=$(cat "$S")"; fi
H="$TMP/h7b"; mkdir -p "$H"
run_hook "$H" "$NOJQ" "$NOJQHOOK" >/dev/null
if [[ ! -e "$H/.claude/settings.json" ]]; then pass "no jq and no settings.json: none is created"
else fail "no jq and no settings.json: none is created" "$(cat "$H/.claude/settings.json")"; fi

# 8. Arguments are not read: any argument is refused.
H="$TMP/h8"; mkdir -p "$H"
out="$(HOME="$H" "$TESTHOOK" '{"x":1}' </dev/null 2>&1)"; rc=$?
if [[ $rc != 0 && ! -e "$H/.claude/settings.json" ]]; then pass "the hook takes no arguments: an argument is refused, nothing written"
else fail "the hook takes no arguments: an argument is refused, nothing written" "rc=$rc out=$out"; fi

# 9. The real hook, HOME not the password database's home: refused, nothing written.
H="$TMP/h9"; mkdir -p "$H"
out="$(run_hook "$H" "" "$HOOK")"; rc=$?
if [[ $rc != 0 && ! -e "$H/.claude" && "$out" == *"password database"* ]]; then pass "HOME is not the user's home from the password database: refused, nothing written"
else fail "HOME is not the user's home from the password database: refused, nothing written" "rc=$rc out=$out"; fi

# 10. GNU stat (stat -f means --file-system: prints file-system lines, fails on '%Lp'): the mode is still kept.
H="$TMP/h10"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"; printf '{"a":1}\n' > "$S"; chmod 640 "$S"
GNUSTAT="$TMP/gnu-stat"
cat > "$GNUSTAT" <<'STUB'
#!/bin/bash
# GNU-style stat: -f is --file-system (an operand '%Lp' that does not exist fails after printing), -c FORMAT
if [[ "$1" == -f ]]; then printf '  File: "%s"\n    ID: 0 Namelen: 255 Type: apfs\n' "$3"; echo "stat: cannot read file system information for '%Lp'" >&2; exit 1; fi
if [[ "$1" == -c && "$2" == %a ]]; then /usr/bin/stat -f %Lp "$3"; exit $?; fi
exit 1
STUB
chmod +x "$GNUSTAT"
GNUHOOK="$(copy_hook gnu pw-home 'PW_HOME="$HOME"' stat "SL_STAT='$GNUSTAT'")" || { echo "could not make the GNU-stat copy"; exit 1; }
out="$(run_hook "$H" "" "$GNUHOOK")"; rc=$?
if [[ $rc == 0 && "$(mode_of "$S")" == 640 && "$(jq -c '.statusLine' "$S")" == "$WANT" ]]; then pass "GNU-style stat: the file's mode (640) is kept"
else fail "GNU-style stat: the file's mode (640) is kept" "rc=$rc out=$out mode=$(mode_of "$S")"; fi

# 11. A fake jq first on the caller's PATH is never used.
H="$TMP/h11"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"; printf '{"a":1}\n' > "$S"
FAKE="$TMP/fakebin"; mkdir -p "$FAKE"
printf '#!/bin/bash\ntouch "%s/fake-jq-ran"\necho "{\\"pwned\\":1}"\n' "$TMP" > "$FAKE/jq"; chmod +x "$FAKE/jq"
out="$(run_hook "$H" "$FAKE:/usr/bin:/bin:/opt/homebrew/bin")"; rc=$?
if [[ $rc == 0 && ! -e "$TMP/fake-jq-ran" && "$(jq -r '.a' "$S")" == 1 && "$(jq -c '.statusLine' "$S")" == "$WANT" ]]; then pass "a fake jq first on PATH is not used"
else fail "a fake jq first on PATH is not used" "rc=$rc out=$out file=$(cat "$S")"; fi

# 12. An empty settings.json counts as {}.
H="$TMP/h12"; mkdir -p "$H/.claude"; S="$H/.claude/settings.json"; : > "$S"; chmod 600 "$S"
out="$(run_hook "$H")"; rc=$?
if [[ $rc == 0 && "$(jq -c '.' "$S" 2>/dev/null)" == "{\"statusLine\":$WANT}" && "$(mode_of "$S")" == 600 ]]; then pass "an empty settings.json counts as {}"
else fail "an empty settings.json counts as {}" "rc=$rc out=$out file=$(cat "$S")"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
