#!/bin/bash
# Tests for oss_json_field in hooks/oss-api-curl.sh - how commands read a field of a server response.
#
# @behavior A field the server sends back is printed to the user's terminal without bytes that can drive
#           or spoof it: control characters (ESC, BEL, CR, C1) and bidi/zero-width characters are removed
#           inside jq, so the raw bytes never reach the shell. A missing or null field prints nothing.
# @business-rule Server text is untrusted; the same stripping rule as stripControl in packages/cli-decrypt.
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
HELPER="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/oss-api-curl.sh"
# shellcheck source=/dev/null
source "$HELPER"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = expected, $3 = got
    RUN=$((RUN + 1))
    if [[ "$2" == "$3" ]]; then echo "✓ PASS: $1"
    else echo "✗ FAIL: $1"; printf '    expected: %q\n    got:      %q\n' "$2" "$3"; FAILED=$((FAILED + 1)); fi
}

HOSTILE='{"chatId":"12\u001b[31m34\u0007\r56\u009b\u202e78\u200b9\u2066","linked":true,"n":42,"gone":null}'
check "strips ESC, BEL, CR, C1, U+202E, U+200B, U+2066 from a field (printable [31m stays)" "12[31m3456789" \
    "$(printf '%s' "$HOSTILE" | oss_json_field chatId)"
check "prints a boolean as true/false text" "true" "$(printf '%s' "$HOSTILE" | oss_json_field linked)"
check "prints a number as text" "42" "$(printf '%s' "$HOSTILE" | oss_json_field n)"
check "prints nothing for a null field" "" "$(printf '%s' "$HOSTILE" | oss_json_field gone)"
check "prints nothing for a missing field" "" "$(printf '%s' "$HOSTILE" | oss_json_field magicLink)"

# T38: line and paragraph separators, BOM, Arabic letter mark, soft hyphen, word joiner and an invisible tag
# character are removed too: every Unicode format character (Cf) plus U+2028/U+2029.
check "strips U+2028, U+2029, U+FEFF, U+061C, U+00AD, U+2060 and a tag character (U+E0041)" "abcdefgh" \
    "$(printf '%s' '{"p":"a\u2028b\u2029c\ufeffd\u061ce\u00adf\u2060g\udb40\udc41h"}' | oss_json_field p)"
# T52: variation selectors (U+FE00-FE0F, U+E0100-E01EF), the combining grapheme joiner and the invisible fillers
# (U+115F, U+1160, U+3164, U+FFA0, braille blank U+2800) are removed too; an emoji with no selector (U+2764,
# U+1F600) and the visible neighbours U+FE10, U+2801, U+3165, U+FFA1, U+0350, U+115E stay.
check "strips variation selectors, U+034F and the invisible fillers; keeps plain emoji and neighbours" \
    $'abcdefghijklm \xe2\x9d\xa4\xf0\x9f\x98\x80 \xef\xb8\x90\xe2\xa0\x81\xe3\x85\xa5\xef\xbe\xa1\xcd\x90\xe1\x85\x9e' \
    "$(printf '%s' '{"p":"a︀b︇c️d󠄀e󠅐f󠇯g͏hᅟiᅠjㅤkﾠl⠀m ❤😀 ︐⠁ㅥﾡ͐ᅞ"}' | oss_json_field p)"
# T38: at most one line, from one JSON object: several documents, or a value that is not an object, give nothing.
check "two concatenated objects print nothing (not one line per object)" "" \
    "$(printf '%s' '{"p":"pro"}{"p":"trial"}' | oss_json_field p)"
check "two objects on two lines print nothing" "" \
    "$(printf '%s\n%s\n' '{"p":"pro"}' '{"p":"trial"}' | oss_json_field p)"
check "an array of objects prints nothing" "" "$(printf '%s' '[{"p":"pro"}]' | oss_json_field p)"
check "a field holding an object prints one line of compact JSON (its newline stays escaped)" '{"a":"b\nc"}' \
    "$(printf '%s' '{"p":{"a":"b\nc"}}' | oss_json_field p)"

# T52b: the shared invisible set (\p{Default_Ignorable_Code_Point}, as the API's cleanText): Khmer inherent vowels
# (U+17B4, U+17B5), Mongolian variation selectors (U+180B, U+180F), unassigned ignorables (U+2065, U+FFF0, U+FFF8)
# and the whole U+E0000-E0FFF block (U+E0000, U+E0FFF) are removed too.
check "strips U+17B4, U+17B5, U+180B, U+180F, U+2065, U+FFF0, U+FFF8, U+E0000 and U+E0FFF" "abcdefghij" \
    "$(printf '%s' '{"p":"a឴b឵c᠋d᠏e⁥f￰g￸h󠀀i󠿿j"}' | oss_json_field p)"
# Visible text is printed as before: ASCII, accents, CJK, Hangul syllables, an emoji with a skin tone; a ZWJ family
# and a heart with U+FE0F lose U+200D and U+FE0F, as they have since T38/T52.
VISIBLE='{"p":"Ascii café üñ 中文 한국어 👍🏽 👨‍👩‍👧 ❤️"}'
VISIBLE_OUT=$'Ascii caf\xc3\xa9 \xc3\xbc\xc3\xb1 \xe4\xb8\xad\xe6\x96\x87 \xed\x95\x9c\xea\xb5\xad\xec\x96\xb4 \xf0\x9f\x91\x8d\xf0\x9f\x8f\xbd \xf0\x9f\x91\xa8\xf0\x9f\x91\xa9\xf0\x9f\x91\xa7 \xe2\x9d\xa4'
check "visible text (accents, CJK, Hangul, emoji) is printed as before" "$VISIBLE_OUT" "$(printf '%s' "$VISIBLE" | oss_json_field p)"
# An older jq (Oniguruma without \p{Default_Ignorable_Code_Point}) falls back to the T52 list: no error, never "".
# The shim renames the property so the real Oniguruma rejects it, as an old one does.
OLDJQ=$(mktemp -d); trap 'rm -rf "${OLDJQ:?}"' EXIT
REAL_JQ=$(command -v jq)
printf '#!/bin/bash\na=(); for x in "$@"; do a+=("${x//Default_Ignorable_Code_Point/Default_Ignorable_Code_PointX}"); done\nexec %q "${a[@]}"\n' \
    "$REAL_JQ" > "$OLDJQ/jq"; chmod 755 "$OLDJQ/jq"
check "the old-jq shim rejects the property (anti-vacuity)" "rejected" \
    "$(PATH="$OLDJQ:$PATH" jq -n '"x" | test("\\p{Default_Ignorable_Code_Point}")' >/dev/null 2>&1 && echo accepted || echo rejected)"
check "an old jq keeps the T52 list (U+200B and U+FE0F stripped, U+17B4 kept), no error" $'ab\xe1\x9e\xb4cd' \
    "$(printf '%s' '{"p":"a​b឴c️d"}' | PATH="$OLDJQ:$PATH" oss_json_field p 2>&1)"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
