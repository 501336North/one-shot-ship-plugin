#!/bin/bash
# Every command line in a ```bash block of a shipped prompt runs without a new approval prompt (T60).
#
# Usage: ./commands/__tests__/bash-blocks-allowlisted.test.sh
#        PLUGIN_UNDER_TEST=/path/to/plugin-copy ./commands/__tests__/bash-blocks-allowlisted.test.sh  (mutants)
#
# @behavior A customer runs any /oss command, skill or agent and sees no approval prompt that the plugin did
#           not already ask for before T57/T58: every shell line the prompt tells Claude to run is covered by
#           the allowlist hooks/oss-setup-permissions.sh installs, or is a line customers already approve.
# @business-rule Claude Code matches a Bash(PREFIX:*) rule literally, so a line passes only when it starts
#           with PREFIX followed by a space or the end of the line. The prefixes are parsed from
#           oss-setup-permissions.sh, never copied here.
# @business-rule A line that is not allowlisted must be on the exemption list bash-allowlist-exempt.txt as
#           "<file><TAB><line>" under one of the groups named below with its reason. An exemption that no
#           longer matches a line is stale and fails too, so the list only ever shrinks.
# @business-rule /oss:status, /oss:workflows and the ideate skill have no exemption for anything T58 added:
#           their API calls go through allowlisted entry points (oss-value.sh status|workflows|workflow,
#           oss-claude-md-template.sh).
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PLUGIN_UNDER_TEST:-$(cd "$HERE/../.." && pwd)}"
EXEMPT="$HERE/bash-allowlist-exempt.txt"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export LC_ALL=C

# The exemption groups and their reasons. A group in the list that is not named here fails.
reason() {
    case "$1" in
        pre-existing) echo "unallowlisted at HEAD f3f897b, before T57/T58: customers approve these lines today; T60 does not grow scope" ;;
        key-check) echo "T57/T58 replaced HEAD's 'cat ~/.oss/config.json | grep apiKey' (which printed the key) in the same file with a grep -q that prints no key: one approval before, one now" ;;
        t71-offload) echo "T71 rewrote Step 2.5 of the 13 offload agents (private prompt dir, deleted before the offloader runs): it replaces that step's two pre-existing unallowlisted calls (mktemp, node agent-offload.js) with two calls, so one approval each, as before" ;;
        pr214-approval) echo "added by #214 (91c808e) to /oss:login and /oss:settings: oss-decisions-policy.sh changes a team setting and is kept off the allowlist on purpose (oss-session-start.sh), the rest sit in blocks that already prompt" ;;
        *) return 1 ;;
    esac
}

# prefixes: the Bash(PREFIX:*) rules oss-setup-permissions.sh installs, one per line
prefixes() { sed -n "s/^[[:space:]]*'Bash(\(.*\):\*)'[[:space:]]*\$/\1/p" "$ROOT/hooks/oss-setup-permissions.sh"; }

# extract <md>: each command line of each ```bash block (any indent): continuations joined, blank and
# comment lines dropped, heredoc bodies skipped, /oss:... lines (slash-command usage, not shell) dropped.
extract() {
    awk '
    /^[[:space:]]*```bash[[:space:]]*$/ { inb = 1; hd = ""; buf = ""; next }
    inb && /^[[:space:]]*```/ { inb = 0; next }
    !inb { next }
    {
        line = $0
        if (hd != "") { t = line; gsub(/^[[:space:]]+|[[:space:]]+$/, "", t); if (t == hd) hd = ""; next }
        if (buf != "") line = buf " " line
        if (line ~ /\\$/) { sub(/\\$/, "", line); buf = line; next }
        buf = ""
        t = line; gsub(/^[[:space:]]+|[[:space:]]+$/, "", t)
        if (t == "" || t ~ /^#/ || t ~ /^\/oss:/) next
        if (match(t, /<<-?[[:space:]]*["\047]?[A-Za-z_]+/)) { h = substr(t, RSTART, RLENGTH); gsub(/^<<-?[[:space:]]*["\047]?/, "", h); hd = h }
        print t
    }' "$1"
}

# unallowed <root>: "<file><TAB><line>" for every extracted line that starts with no allowlisted prefix
unallowed() {
    local r="$1" f c p ok
    local IFS=$'\n'; local pf=($(prefixes)); unset IFS
    (cd "$r" && find commands agents skills -name '*.md' -not -path '*/__tests__/*' | sort) | while IFS= read -r f; do
        extract "$r/$f" | while IFS= read -r c; do
            ok=0
            for p in "${pf[@]}"; do case "$c" in "$p" | "$p "*) ok=1; break ;; esac; done
            [[ $ok == 1 ]] || printf '%s\t%s\n' "$f" "$c"
        done
    done
}

# exemptions: "<file><TAB><line>" of every exemption; groups -> $T/groups ("<group> <count>")
exemptions() {
    awk -F'\t' -v g="$T/groups" '
        /^#/ || /^$/ { next }
        /^@/ { grp = substr($0, 2); n[grp] += 0; next }
        { print; n[grp]++ }
        END { for (k in n) print k, n[k] > g }' "$EXEMPT"
}

# --- anchors: the parser and the detector see what they must, so a pass is never vacuous -------------
PF=$(prefixes)
[[ $(printf '%s\n' "$PF" | grep -c .) -ge 15 ]] && printf '%s\n' "$PF" | grep -qxF '~/.oss/hooks/oss-value.sh' \
    && printf '%s\n' "$PF" | grep -qxF '~/.oss/bin/oss-decrypt' \
    && pass "the allowlist parses from oss-setup-permissions.sh (>= 15 prefixes, oss-value.sh and oss-decrypt among them)" \
    || fail "the allowlist parses from oss-setup-permissions.sh" "got: $(printf '%s ' $PF)"

mkdir -p "$T/fx/commands" "$T/fx/agents" "$T/fx/skills" "$T/fx/hooks"
cp "$ROOT/hooks/oss-setup-permissions.sh" "$T/fx/hooks/"
cat > "$T/fx/commands/fx.md" <<'FIXTURE'
```bash
# a comment
~/.oss/hooks/oss-value.sh status
~/.oss/hooks/oss-value.sh.bak status
. ~/.oss/hooks/oss-api-curl.sh
~/.oss/bin/oss-decrypt --type agents \
  --name x
cat > f <<'EOF'
not a command
EOF
/oss:status [OPTIONS]
```
1. Step:
   ```bash
   oss_api_curl "$OSS_KEY" "$OSS_URL/x"
   ```
```text
curl -H "Authorization: Bearer x"
```
FIXTURE
got=$(unallowed "$T/fx" | cut -f2)
want=$'~/.oss/hooks/oss-value.sh.bak status\n. ~/.oss/hooks/oss-api-curl.sh\ncat > f <<\'EOF\'\noss_api_curl "$OSS_KEY" "$OSS_URL/x"'
[[ "$got" == "$want" ]] && pass "detector control: flags exactly the 4 unallowlisted lines (prefix must end at a space, heredoc body, indented fence; not text blocks or /oss: usage)" \
    || fail "detector control: flags exactly the 4 unallowlisted lines" "got: $(printf '%s' "$got" | tr '\n' '|')"

ALL=$( (cd "$ROOT" && find commands agents skills -name '*.md' -not -path '*/__tests__/*') | while IFS= read -r f; do extract "$ROOT/$f" | sed "s|^|$f	|"; done)
NF=$(printf '%s\n' "$ALL" | cut -f1 | sort -u | grep -c .); NL=$(printf '%s\n' "$ALL" | grep -c .)
[[ $NF -ge 100 && $NL -ge 1000 ]] && printf '%s\n' "$ALL" | grep -qxF "skills/ideate.md	~/.oss/bin/oss-decrypt --type workflows --name ideate" \
    && pass "the scan reads every shipped prompt ($NF files with bash blocks, $NL command lines, skills/ideate.md's decrypt line among them)" \
    || fail "the scan reads every shipped prompt" "files=$NF lines=$NL"

# --- the exemption list ----------------------------------------------------------------------------
[[ -f "$EXEMPT" ]] || fail "bash-allowlist-exempt.txt exists" "missing"
exemptions | sort -u > "$T/exempt"
bad_group=''
while read -r g n; do reason "$g" >/dev/null || bad_group="$bad_group $g"; [[ -n "$g" && "$n" -gt 0 ]] || bad_group="$bad_group $g(empty)"; done < "$T/groups"
[[ -z "$bad_group" && -s "$T/groups" ]] && pass "every exemption group is named in this test with a reason ($(tr '\n' ' ' < "$T/groups"))" \
    || fail "every exemption group is named in this test with a reason" "unknown or empty:$bad_group"
t58=$(grep -E '^(commands/status\.md|commands/workflows\.md|skills/ideate\.md)	' "$T/exempt" | grep -vxF "skills/ideate.md	test -f CLAUDE.md && echo \"EXISTS\" || echo \"MISSING\"")
[[ -z "$t58" ]] && pass "status.md, workflows.md and skills/ideate.md have no exemption beyond ideate's pre-existing CLAUDE.md check" \
    || fail "status.md, workflows.md and skills/ideate.md have no exemption for what T58 added" "$(printf '%s' "$t58" | tr '\n' '|')"
leak=$(grep -cE 'oss_api_curl|oss_api_creds' "$T/exempt")
[[ "$leak" == 0 ]] && pass "no exemption is a prompt line that hands the key to curl (oss_api_creds / oss_api_curl belong in a hook)" \
    || fail "no exemption hands the key to curl in a prompt" "$(grep -E 'oss_api_curl|oss_api_creds' "$T/exempt" | tr '\n' '|')"

# --- the rule ----------------------------------------------------------------------------------------
unallowed "$ROOT" | sort -u > "$T/now"
viol=$(comm -23 "$T/now" "$T/exempt")
stale=$(comm -13 "$T/now" "$T/exempt")
if [[ -z "$viol" ]]; then
    pass "every bash line in commands/, agents/ and skills/ is allowlisted or exempt ($(grep -c . "$T/now") exempt lines in use)"
else
    while IFS=$'\t' read -r f c; do fail "$f runs a line that is not allowlisted (new approval prompt)" "$c"; done <<< "$viol"
fi
if [[ -z "$stale" ]]; then
    pass "no stale exemption (each one still matches a line)"
else
    while IFS=$'\t' read -r f c; do fail "stale exemption: $f no longer runs this line; remove it from bash-allowlist-exempt.txt" "$c"; done <<< "$stale"
fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
