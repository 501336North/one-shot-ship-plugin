#!/bin/bash
# oss_api_url sends the key only to a trusted OSS API, by the same rule as the CLI and the watcher (ship round 1:
# FR4, FR5, FR6, FR7).
#
# @behavior For every row of packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json, oss_api_url prints the
#           row's canonical origin when it is trusted (production, staging, loopback http; trailing "/", ":443"
#           and host case normalised) and refuses (rc 1, nothing printed) otherwise. Without jq, a config that
#           names an apiUrl is refused, never silently read as production. The config file itself is refused
#           when it is a symlink or world-writable (and its key is not read); group-writable is accepted.
#           A loopback apiUrl additionally needs a config.json and directory no other user can write (SR2).
#           The URL and the key come from the one copy read after the trust check, never from a file swapped in
#           later (SR3).
# @business-rule The OSS API key goes only to an OSS API. A look-alike or custom host never receives it, and a
#           missing tool never hides that a session is pointed at STAGING.
#
# Usage: ./hooks/__tests__/oss-api-trust.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
TABLE="$ROOT/packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.oss"; chmod 700 "$T/.oss"

call() {  # call <function> [PATH override]: prints output, sets RC
    OUT=$(HOME="$T" PATH="${2:-$PATH}" "$SH" -c 'source "$1"; '"$1" _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
}

n=$(jq length "$TABLE")
for (( i = 0; i < n; i++ )); do
    url=$(jq -r ".[$i].apiUrl" "$TABLE"); trusted=$(jq -r ".[$i].trusted" "$TABLE"); canon=$(jq -r ".[$i].canonical // \"\"" "$TABLE")
    jq -n --arg u "$url" '{apiKey:"k",apiUrl:$u}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    call oss_api_url
    if [[ "$trusted" == true ]]; then
        [[ "$RC" == 0 && "$OUT" == "$canon" ]] && pass "trusted: $url -> $canon" || fail "trusted: $url -> $canon" "rc=$RC out='$OUT'"
    else
        [[ "$RC" != 0 && -z "$OUT" ]] && pass "refused: $url" || fail "refused: $url" "rc=$RC out='$OUT'"
    fi
done

# FR5: no jq. A PATH with every command but jq.
mkdir -p "$T/nojq"; IFS=: read -ra dirs <<< "$PATH"
for d in "${dirs[@]}"; do for f in "$d"/*; do b=${f##*/}; [[ "$b" == jq || -e "$T/nojq/$b" ]] || ln -s "$f" "$T/nojq/$b" 2>/dev/null; done; done
printf '{"apiKey":"k","apiUrl":"https://one-shot-ship-api-staging.onrender.com"}' > "$T/.oss/config.json"
call oss_api_url "$T/nojq"
[[ "$RC" != 0 && -z "$OUT" ]] && pass "without jq, a config that names an apiUrl is refused (never read as production)" \
    || fail "without jq, a config that names an apiUrl is refused" "rc=$RC out='$OUT'"
for cfg in '{"apiKey":"k","apiUrl":""}' '{"apiKey":"k","apiUrl":null}' '{"apiKey":"k", "apiUrl" : ""}'; do
    printf '%s' "$cfg" > "$T/.oss/config.json"; call oss_api_url "$T/nojq"
    [[ "$RC" == 0 && "$OUT" == "https://one-shot-ship-api.onrender.com" ]] && pass "without jq, an empty or null apiUrl still means production ($cfg)" \
        || fail "without jq, an empty or null apiUrl still means production ($cfg)" "rc=$RC out='$OUT'"
done
printf '{"apiKey":"k"}' > "$T/.oss/config.json"
call oss_api_url "$T/nojq"
[[ "$RC" == 0 && "$OUT" == "https://one-shot-ship-api.onrender.com" ]] && pass "without jq, a config with no apiUrl still means production" \
    || fail "without jq, a config with no apiUrl still means production" "rc=$RC out='$OUT'"

# FR7: the config file's trust.
printf '{"apiKey":"secret-k","apiUrl":"https://one-shot-ship-api.onrender.com"}' > "$T/real.json"
for m in 666 646; do
    cp "$T/real.json" "$T/.oss/config.json"; chmod "$m" "$T/.oss/config.json"
    call oss_api_url; r1=$RC; o1=$OUT; call oss_api_key; r2=$RC; o2=$OUT
    [[ "$r1" != 0 && -z "$o1" && "$r2" != 0 && -z "$o2" ]] && pass "a world-writable config ($m) is refused for the URL and the key" \
        || fail "a world-writable config ($m) is refused" "url rc=$r1 '$o1' key rc=$r2 '$o2'"
done
cp "$T/real.json" "$T/.oss/config.json"; chmod 664 "$T/.oss/config.json"
call oss_api_key; r2=$RC; o2=$OUT; call oss_api_url
[[ "$RC" == 0 && "$r2" == 0 && "$o2" == secret-k ]] && pass "a group-writable config (664, umask 002) is accepted" \
    || fail "a group-writable config (664) is accepted" "url rc=$RC key rc=$r2"
rm -f "$T/.oss/config.json"; ln -s "$T/real.json" "$T/.oss/config.json"
call oss_api_url; r1=$RC; o1=$OUT; call oss_api_key
[[ "$r1" != 0 && -z "$o1" && "$RC" != 0 && -z "$OUT" ]] && pass "a symlinked config is refused for the URL and the key" \
    || fail "a symlinked config is refused" "url rc=$r1 '$o1' key rc=$RC '$OUT'"

# SR2: a LOOPBACK apiUrl (where the key goes to whatever listens on this machine's port) is trusted only when no one
# but the user can write config.json or its directory; production/staging keep the FR7 rule (group-writable accepted).
loopback_case() {  # loopback_case <url> <file mode> <dir mode> <want: trusted|refused> <label>
    rm -f "$T/.oss/config.json"; printf '{"apiKey":"k","apiUrl":"%s"}' "$1" > "$T/.oss/config.json"; chmod "$2" "$T/.oss/config.json"; chmod "$3" "$T/.oss"
    call oss_api_url; chmod 700 "$T/.oss"; chmod 600 "$T/.oss/config.json"
    if [[ "$4" == trusted ]]; then [[ "$RC" == 0 && -n "$OUT" ]] && pass "$5" || fail "$5" "rc=$RC out='$OUT'"
    else [[ "$RC" != 0 && -z "$OUT" ]] && pass "$5" || fail "$5" "rc=$RC out='$OUT'"; fi
}
loopback_case http://localhost:3001 664 700 refused "a group-writable config (664) cannot point the key at loopback"
loopback_case http://127.0.0.1:9 600 775 refused "a loopback apiUrl in a group-writable directory (775) is refused"
loopback_case "http://[::1]:8080" 600 707 refused "a loopback apiUrl in a world-writable directory (707) is refused"
loopback_case http://localhost:3001 600 700 trusted "a loopback apiUrl in a private config (600 in 700) is trusted"
loopback_case https://one-shot-ship-api.onrender.com 664 700 trusted "production with a group-writable config (664) is still trusted"
loopback_case https://one-shot-ship-api-staging.onrender.com 600 775 trusted "staging in a group-writable directory (775) is still trusted (directory not checked)"

# SR3: check once, read once. The URL and the key come from the one copy read right after the trust check, so a
# config.json swapped afterwards (here: by the JSON parser's own start-up, a shim that renames an attacker's
# world-writable file over it) is never what the key or the URL is taken from.
swap_case() {  # swap_case <tool to shim> <PATH base dir or ""> <original config> <function> <want> <label>
    local bin="$T/swap-$1"; rm -rf "$bin"; mkdir -p "$bin"
    printf '#!/bin/bash\n[[ -f "%s" ]] && mv -f "%s" "%s"\nexec "%s" "$@"\n' "$T/evil.json" "$T/evil.json" "$T/.oss/config.json" "$(command -v "$1")" > "$bin/$1"
    chmod +x "$bin/$1"
    rm -f "$T/.oss/config.json"; printf '%s' "$3" > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    printf '{"apiKey":"evil-k","apiUrl":"https://one-shot-ship-api-staging.onrender.com"}' > "$T/evil.json"; chmod 666 "$T/evil.json"
    call "$4" "$bin:${2:-$PATH}"   # the shim first, so it shadows the real tool
    rm -f "$T/evil.json"
    [[ "$RC" == 0 && "$OUT" == "$5" ]] && pass "$6" || fail "$6" "rc=$RC out='$OUT'"
}
swap_case jq "" '{"apiKey":"secret-k","apiUrl":"https://one-shot-ship-api.onrender.com"}' oss_api_url \
    https://one-shot-ship-api.onrender.com "the URL comes from the config that was checked, not one swapped in after (jq)"
swap_case jq "" '{"apiKey":"secret-k","apiUrl":"https://one-shot-ship-api.onrender.com"}' oss_api_key \
    secret-k "the key comes from the config that was checked, not one swapped in after (jq)"
swap_case grep "$T/nojq" '{"apiKey":"secret-k"}' oss_api_url \
    https://one-shot-ship-api.onrender.com "without jq, the URL comes from the config that was checked"
swap_case grep "$T/nojq" '{"apiKey":"secret-k"}' oss_api_key \
    secret-k "without jq, the key comes from the config that was checked"

# The permission check works with GNU/busybox stat too (Linux): a stand-in that answers `-c %a` and treats `-f` as
# --file-system (file-system details on stdout, rc 1 for the "%Lp" operand), as GNU stat does.
mkdir -p "$T/gnustat"; real_stat=$(command -v stat)
printf '#!/bin/bash\ncase " $* " in\n  *" -c "*) shift 3; exec %s -L -f %%Lp "$@" ;;\n  *) echo "  File: \"$4\""; echo "    ID: 0 Namelen: 255"; exit 1 ;;\nesac\n' "$real_stat" > "$T/gnustat/stat"
chmod +x "$T/gnustat/stat"
gnu_case() {  # gnu_case <url> <file mode> <want> <label>
    rm -f "$T/.oss/config.json"; printf '{"apiKey":"k","apiUrl":"%s"}' "$1" > "$T/.oss/config.json"; chmod "$2" "$T/.oss/config.json"
    call oss_api_url "$T/gnustat:$PATH"; chmod 600 "$T/.oss/config.json"
    if [[ "$3" == trusted ]]; then [[ "$RC" == 0 && -n "$OUT" ]] && pass "$4" || fail "$4" "rc=$RC out='$OUT'"
    else [[ "$RC" != 0 && -z "$OUT" ]] && pass "$4" || fail "$4" "rc=$RC out='$OUT'"; fi
}
gnu_case http://localhost:3001 600 trusted "with GNU stat: a private loopback config is trusted"
gnu_case http://localhost:3001 664 refused "with GNU stat: a group-writable loopback config is refused"
gnu_case https://one-shot-ship-api.onrender.com 646 refused "with GNU stat: a world-writable config is refused"

# The channel layout (scripts/oss-channel.sh): ~/.oss is a SYMLINK to ~/.oss-stable / ~/.oss-beta / ~/.oss-dev. The
# loopback rule checks the folder the link resolves to (a symlinked config DIRECTORY is supported; a symlinked
# config.json FILE stays refused, above).
channel_dir_case() {  # channel_dir_case <target dir mode> <want> <label>
    local h="$T/chome"; rm -rf "$h"; mkdir -p "$h/.oss-beta"; chmod "$1" "$h/.oss-beta"; ln -s "$h/.oss-beta" "$h/.oss"
    printf '{"apiKey":"k","apiUrl":"http://localhost:3001"}' > "$h/.oss-beta/config.json"; chmod 600 "$h/.oss-beta/config.json"
    OUT=$(HOME="$h" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
    KEY=$(HOME="$h" "$SH" -c 'source "$1"; oss_api_key' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null)
    chmod 700 "$h/.oss-beta"
    if [[ "$2" == trusted ]]; then [[ "$RC" == 0 && "$OUT" == http://localhost:3001 && "$KEY" == k ]] && pass "$3" || fail "$3" "rc=$RC out='$OUT' key='$KEY'"
    else [[ "$RC" != 0 && -z "$OUT" ]] && pass "$3" || fail "$3" "rc=$RC out='$OUT'"; fi
}
channel_dir_case 700 trusted "~/.oss -> ~/.oss-beta (0700), config 0600, loopback: trusted (the channel layout)"
channel_dir_case 775 refused "~/.oss -> ~/.oss-beta (0775), config 0600, loopback: refused (the link's target is checked)"

# SR16: the team IRON LAWS fetch (oss_custom_iron_laws) sends the key only where oss_api_url allows: an untrusted
# apiUrl (a custom host, or loopback named by a group-writable config) makes no curl call at all.
mkdir -p "$T/curlrec"; printf '#!/bin/bash\necho "$*" >> "%s/curl-calls"\nprintf "## Custom Team Laws\\n- x\\n\\n200"\n' "$T" > "$T/curlrec/curl"; chmod +x "$T/curlrec/curl"
for row in "https://api.example.com 600" "http://localhost:3001 664"; do
    set -- $row; rm -f "$T/curl-calls" "$T/.oss/config.json"
    printf '{"apiKey":"k","apiUrl":"%s"}' "$1" > "$T/.oss/config.json"; chmod "$2" "$T/.oss/config.json"
    call oss_custom_iron_laws "$T/curlrec:$PATH"; chmod 600 "$T/.oss/config.json"
    [[ "$RC" != 0 && -z "$OUT" && ! -e "$T/curl-calls" ]] && pass "team laws: untrusted apiUrl ($1, config $2) → no curl, nothing printed" \
        || fail "team laws: untrusted apiUrl ($1, config $2) → no curl" "rc=$RC out='$OUT' calls=$(cat "$T/curl-calls" 2>/dev/null)"
done
rm -f "$T/curl-calls"; printf '{"apiKey":"k","apiUrl":"http://localhost:3001"}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
call oss_custom_iron_laws "$T/curlrec:$PATH"
[[ "$RC" == 0 && "$OUT" == *$'\n## Custom Team Laws\n'* && "$(cat "$T/curl-calls")" == *"http://localhost:3001/api/v1/prompts/shared/iron-laws?part=custom" ]] \
    && pass "team laws: a trusted apiUrl is fetched at <origin>/api/v1/prompts/shared/iron-laws?part=custom" \
    || fail "team laws: a trusted apiUrl is fetched" "rc=$RC out='$OUT' calls=$(cat "$T/curl-calls" 2>/dev/null)"

# TR5: oss_custom_iron_laws takes the URL AND the key from one read of the config (SR3). A jq shim swaps another config
# in on its first start (oss_api_url's parse); a second read for the key would send that file's key. The swapped-in
# file is private here (600), so only a second read, not the trust check, can tell the two apart.
mkdir -p "$T/swap-one"
printf '#!/bin/bash\n[[ -f "%s" ]] && mv -f "%s" "%s"\nexec "%s" "$@"\n' "$T/evil.json" "$T/evil.json" "$T/.oss/config.json" "$(command -v jq)" > "$T/swap-one/jq"
printf '#!/bin/bash\ncat > "%s/sent-config"\nprintf "## Custom Team Laws\\n- x\\n\\n200"\n' "$T" > "$T/swap-one/curl"; chmod +x "$T/swap-one/jq" "$T/swap-one/curl"
rm -f "$T/.oss/config.json" "$T/sent-config"; printf '{"apiKey":"secret-k"}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
printf '{"apiKey":"evil-k"}' > "$T/evil.json"; chmod 600 "$T/evil.json"
call oss_custom_iron_laws "$T/swap-one:$PATH"; rm -f "$T/evil.json"
sent=$(cat "$T/sent-config" 2>/dev/null)
[[ "$RC" == 0 && "$sent" == *"Bearer secret-k"* ]] && pass "team laws: the key sent comes from the same read as the URL (one config read)" \
    || fail "team laws: the key sent comes from the same read as the URL" "rc=$RC sent='$sent'"

# TR6: without jq the key is read by a regex that takes the FIRST "apiKey" (a nested one too) and stops at an escaped
# quote. A config it cannot read unambiguously is refused rather than sending a wrong or truncated key; jq reads it.
nojq_key_case() {  # nojq_key_case <config> <label>
    rm -f "$T/.oss/config.json"; printf '%s' "$1" > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    call oss_api_key "$T/nojq"
    [[ "$RC" != 0 && -z "$OUT" ]] && pass "without jq: $2 → no key (refused)" || fail "without jq: $2 → refused" "rc=$RC out='$OUT'"
}
nojq_key_case '{"meta":{"apiKey":"nested-k"},"apiKey":"top-k"}' "a nested apiKey before the top-level one"
nojq_key_case '{"apiKey":"first-k","apiKey":"second-k"}' "a duplicated apiKey"
nojq_key_case '{"apiKey":"ab\"cd"}' "an apiKey with an escaped quote"
printf '{"meta":{"apiKey":"nested-k"},"apiKey":"top-k"}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
call oss_api_key
[[ "$RC" == 0 && "$OUT" == top-k ]] && pass "with jq: the top-level apiKey is read, a nested one ignored (unchanged)" \
    || fail "with jq: the top-level apiKey is read" "rc=$RC out='$OUT'"
printf '{"apiKey":"plain-k"}' > "$T/.oss/config.json"; call oss_api_key "$T/nojq"
[[ "$RC" == 0 && "$OUT" == plain-k ]] && pass "without jq: the flat config /oss:login writes still gives its key" \
    || fail "without jq: the flat config still gives its key" "rc=$RC out='$OUT'"

# UR3 (#1b): without jq, a regex reads the config, and it disagreed with jq / JSON.parse (the CLI) on duplicate keys, \u
# escapes, nested keys and invalid JSON. Such a config is refused for the key AND the URL unless it is flat: one object
# of string keys to scalar values (or arrays of scalars), no backslash anywhere, exactly one "{".
nojq_refused_case() {  # nojq_refused_case <config> <label>
    rm -f "$T/.oss/config.json"; printf '%s' "$1" > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    call oss_api_key "$T/nojq"; local kr=$RC ko=$OUT
    call oss_api_url "$T/nojq"
    [[ "$kr" != 0 && -z "$ko" && "$RC" != 0 && -z "$OUT" ]] && pass "without jq: $2 → key AND URL refused" \
        || fail "without jq: $2 → key AND URL refused" "key rc=$kr '$ko' url rc=$RC '$OUT'"
}
nojq_refused_case '{"apiKey":"evil","\u0061piKey":"abc"}' 'a \u-spelled second apiKey (JSON: abc)'
nojq_refused_case '{"api\u004bey":"abc"}' 'a \u-spelled apiKey'
nojq_refused_case '{"meta":{"apiKey":"nested-k"}}' 'a nested-only apiKey (JSON: none)'
nojq_refused_case '{"apiKey":"A",}' 'invalid JSON (trailing comma)'
nojq_refused_case '{"apiKey":"A" "x":1}' 'invalid JSON (missing comma)'
nojq_refused_case '{"apiKey":"k","api\u0055rl":"https://one-shot-ship-api-staging.onrender.com"}' 'an escaped apiUrl naming staging (CLI: staging)'
rm -f "$T/.oss/config.json"; printf '{"apiKey":"evil","apiKey":"abc"}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
call oss_api_key "$T/nojq"
[[ "$RC" != 0 && -z "$OUT" ]] && pass "without jq: a duplicated apiKey (JSON: the last) → no key" || fail "without jq: a duplicated apiKey → no key" "rc=$RC out='$OUT'"
nojq_flat_case() {  # nojq_flat_case <config> <want key> <want url> <label>
    rm -f "$T/.oss/config.json"; printf '%s' "$1" > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    call oss_api_key "$T/nojq"; local ko=$OUT
    call oss_api_url "$T/nojq"
    [[ "$ko" == "$2" && "$OUT" == "$3" ]] && pass "without jq: $4 → still read" || fail "without jq: $4 → still read" "key '$ko' url '$OUT'"
}
nojq_flat_case $' {\n  "apiKey": "flat-k",\n  "n": -1.5e3, "b": true, "z": null, "tags": ["a", 2, false], "e": []\n}\n' flat-k \
    https://one-shot-ship-api.onrender.com "a pretty-printed flat config with numbers, booleans, null and arrays of scalars"
rm -f "$T/.oss/config.json"; call oss_api_url "$T/nojq"
[[ "$RC" == 0 && "$OUT" == https://one-shot-ship-api.onrender.com ]] && pass "without jq: no config at all still means production" \
    || fail "without jq: no config at all still means production" "rc=$RC out='$OUT'"
for cfg in '{"apiKey":"evil","\u0061piKey":"abc"}' '{"meta":{"apiKey":"nested-k"},"apiKey":"top-k"}'; do
    printf '%s' "$cfg" > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"; call oss_api_key
    [[ "$RC" == 0 && -n "$OUT" && "$OUT" != evil && "$OUT" != nested-k ]] && pass "with jq: $cfg is read as JSON reads it (unchanged)" \
        || fail "with jq: $cfg is read as JSON reads it" "rc=$RC out='$OUT'"
done

# UR4: _oss_config_read leaves _OSS_CFG empty on EVERY failure. A NUL byte stops `read -d ''` with rc 0 and the text
# before it in the variable; a caller that ignored the rc would still find a key there.
rm -f "$T/.oss/config.json"; printf '{"apiKey":"pre-nul-k"}\0{"apiKey":"x"}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
for p in "$PATH" "$T/nojq"; do
    lbl="with jq"; [[ "$p" == "$T/nojq" ]] && lbl="without jq"
    call '_oss_config_read; echo "rc=$? cfg=[$_OSS_CFG] key=[$(_oss_cfg_key)]"' "$p"
    [[ "$OUT" == "rc=1 cfg=[] key=[]" ]] && pass "a config holding a NUL byte: rc 1, _OSS_CFG empty, no key ($lbl)" \
        || fail "a config holding a NUL byte: rc 1, _OSS_CFG empty, no key ($lbl)" "$OUT"
done
printf '{"apiKey":"k"}' > "$T/.oss/config.json"; chmod 000 "$T/.oss/config.json"
call '_oss_config_read; echo "rc=$? cfg=[$_OSS_CFG]"; oss_api_url; echo "url-rc=$?"'
[[ "$OUT" == $'rc=1 cfg=[]\nurl-rc=1' ]] && pass "an unreadable (mode 000) config: rc 1, and no URL (not read as a missing config, i.e. production)" \
    || fail "an unreadable (mode 000) config: rc 1, no URL" "$OUT"
chmod 666 "$T/.oss/config.json"
call '_OSS_CFG=stale; _oss_config_read; echo "rc=$? cfg=[$_OSS_CFG]"'; chmod 600 "$T/.oss/config.json"
[[ "$OUT" == "rc=1 cfg=[]" ]] && pass "an untrusted (world-writable) config: rc 1, _OSS_CFG empty" || fail "an untrusted config: rc 1, _OSS_CFG empty" "$OUT"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
