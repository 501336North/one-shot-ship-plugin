#!/bin/bash
# Tests for scripts/check-manifest-inventory.sh — the release check (R-273 R2) that every prompt the
# plugin fetches by a literal name is in the server's prompt manifest.
#
# @behavior Before a plugin release, the releaser runs the check against a manifest and learns which
#           `oss-decrypt --type <t> --name <n>` call in the shipped commands, agents, skills and hooks
#           names a prompt the manifest does not list, so no user hits a fetch that cannot verify.
# @business-rule A shipped literal prompt name with no manifest key fails the check and is named.
#           Custom team prompts, placeholder or variable names, test fixtures and files outside the
#           shipped dirs are not shipped literal fetches, so they never fail it. Indirect fetches
#           through `oss-value.sh decrypt` cannot be resolved statically: they are listed for a
#           manual review and never fail the check.
#
# Offline only: every manifest and tree here is a fixture; nothing reaches the network.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$SCRIPT_DIR/../check-manifest-inventory.sh"

PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((PASS++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  $2"; ((FAIL++)); }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

H1=1111111111111111111111111111111111111111111111111111111111111111
H2=2222222222222222222222222222222222222222222222222222222222222222
H3=3333333333333333333333333333333333333333333333333333333333333333
S1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
S2=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
S3=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

# Shaped like the real manifest: a signed envelope, `workflows/*` aliases that share their
# `commands/*` target's hash, and a `servedHash` on every entry.
FULL="$SB/manifest-full.json"
cat > "$FULL" <<EOF
{
  "version": 1794940034,
  "generatedAt": "2026-11-17T18:27:14.722Z",
  "algorithm": "sha256",
  "prompts": {
    "CLAUDE": { "hash": "$H3", "size": 10, "servedHash": "$S3" },
    "agents/typescript-pro": { "hash": "$H1", "size": 100, "servedHash": "$S1" },
    "commands/plan": { "hash": "$H2", "size": 200, "servedHash": "$S2" },
    "workflows/plan": { "hash": "$H2", "size": 200, "servedHash": "$S2" },
    "commands/build": { "hash": "$H3", "size": 300, "servedHash": "$S3" },
    "workflows/build": { "hash": "$H3", "size": 300, "servedHash": "$S3" },
    "skills/ui-ux": { "hash": "$H1", "size": 50, "servedHash": "$S1" }
  },
  "signing": { "keyId": "fixture" },
  "signature": "fixture-signature"
}
EOF

# The same manifest without the two workflow aliases (the shape before R-273's API change).
NO_WF="$SB/manifest-no-workflows.json"
jq 'del(.prompts["workflows/plan"], .prompts["workflows/build"])' "$FULL" > "$NO_WF"

# A plugin tree whose shipped dirs fetch each key of the full manifest once, in the shapes the real
# files use (code fence, backticks, a quoted binary path, a hook).
mk_tree() { # $1 = tree dir
  local t="$1"
  mkdir -p "$t/commands" "$t/agents" "$t/skills/ui" "$t/hooks"
  cat > "$t/commands/plan.md" <<'EOF'
# plan
```bash
~/.oss/bin/oss-decrypt --type workflows --name plan
```
Then run `~/.oss/bin/oss-decrypt --type agents --name typescript-pro` for the agent.
EOF
  cat > "$t/commands/build.md" <<'EOF'
~/.oss/bin/oss-decrypt --type workflows --name build
~/.oss/bin/oss-decrypt --type commands --name build
EOF
  cat > "$t/skills/ui/SKILL.md" <<'EOF'
~/.oss/bin/oss-decrypt --type skills --name ui-ux
EOF
  cat > "$t/agents/typescript-pro.md" <<'EOF'
"$HOME/.oss/bin/oss-decrypt" --type commands --name plan
EOF
  cat > "$t/hooks/fetch.sh" <<'EOF'
#!/bin/bash
~/.oss/bin/oss-decrypt --type agents --name typescript-pro > /dev/null
EOF
}

run_check() { # $1 = manifest, $2 = tree; sets OUT and RC
  OUT="$(bash "$CHECK" "$1" "$2" 2>&1)"; RC=$?
}

# 1. Every literal fetch has a key → passes.
T1="$SB/t1"; mk_tree "$T1"
run_check "$FULL" "$T1"
if [[ -f "$CHECK" && $RC -eq 0 ]] && ! grep -q '^MISSING ' <<<"$OUT"; then
  pass "passes when every literal oss-decrypt --type/--name in the shipped dirs has a manifest key"
else fail "all keys present" "rc=$RC out=$OUT"; fi

# 2. Missing keys → fails and names each missing <t>/<n>.
run_check "$NO_WF" "$T1"
if [[ $RC -ne 0 ]] && grep -q '^MISSING workflows/plan ' <<<"$OUT" && grep -q '^MISSING workflows/build ' <<<"$OUT"; then
  pass "fails and names each missing <t>/<n> (workflows/plan, workflows/build)"
else fail "missing keys named" "rc=$RC out=$OUT"; fi

# 2b. A present key is not reported as missing alongside the missing ones.
if [[ $RC -ne 0 ]] && grep -q '^MISSING workflows/plan ' <<<"$OUT" \
   && ! grep -qE '^MISSING (agents/typescript-pro|commands/plan|skills/ui-ux) ' <<<"$OUT"; then
  pass "a key the manifest has is not reported as missing"
else fail "present key not reported" "rc=$RC out=$OUT"; fi

# 3. A key in a skill subdir and in a hook is checked too (all four shipped dirs, recursively).
T3="$SB/t3"; mk_tree "$T3"
echo '~/.oss/bin/oss-decrypt --type skills --name not-in-manifest' > "$T3/skills/ui/extra.md"
echo '~/.oss/bin/oss-decrypt --type agents --name ghost-agent' >> "$T3/hooks/fetch.sh"
run_check "$FULL" "$T3"
if [[ $RC -ne 0 ]] && grep -q '^MISSING skills/not-in-manifest ' <<<"$OUT" && grep -q '^MISSING agents/ghost-agent ' <<<"$OUT"; then
  pass "checks literal fetches in skill subdirs and hooks"
else fail "skills subdir + hooks scanned" "rc=$RC out=$OUT"; fi

# 4. Ignores custom, non-literal names, and anything outside the shipped dirs.
T4="$SB/t4"; mk_tree "$T4"
cat > "$T4/commands/odd.md" <<'EOF'
~/.oss/bin/oss-decrypt --type custom --name review-standards
~/.oss/bin/oss-decrypt --type "$t" --name "$n"
~/.oss/bin/oss-decrypt --type workflows --name "$n"
~/.oss/bin/oss-decrypt --type workflows --name {{id}}
~/.oss/bin/oss-decrypt --type <category> --name <name>
~/.oss/bin/oss-decrypt --type agents --name $NAME
EOF
mkdir -p "$T4/docs" "$T4/scripts"
echo '~/.oss/bin/oss-decrypt --type workflows --name docs-only' > "$T4/docs/guide.md"
echo '~/.oss/bin/oss-decrypt --type workflows --name script-only' > "$T4/scripts/x.sh"
echo '~/.oss/bin/oss-decrypt --type workflows --name root-only' > "$T4/README.md"
run_check "$FULL" "$T4"
if [[ -f "$CHECK" && $RC -eq 0 ]] && ! grep -qE '^MISSING .*(custom|docs-only|script-only|root-only|\{\{|<name|\$)' <<<"$OUT"; then
  pass "ignores custom, non-literal names (\"\$n\", {{id}}, <name>) and files outside the shipped dirs"
else fail "ignored shapes" "rc=$RC out=$OUT"; fi

# 5. Test fixtures under __tests__ are not shipped fetches (they use made-up types and names).
T5="$SB/t5"; mk_tree "$T5"
mkdir -p "$T5/hooks/__tests__" "$T5/commands/__tests__"
echo '~/.oss/bin/oss-decrypt --type T --name fixture-name' > "$T5/hooks/__tests__/x.test.sh"
echo '~/.oss/bin/oss-decrypt --type prompts --name fake' > "$T5/commands/__tests__/y.test.sh"
run_check "$FULL" "$T5"
if [[ -f "$CHECK" && $RC -eq 0 ]] && ! grep -qE 'T/fixture-name|prompts/fake' <<<"$OUT"; then
  pass "ignores test fixtures under __tests__ inside the shipped dirs"
else fail "__tests__ ignored" "rc=$RC out=$OUT"; fi

# 6. Lists the oss-value.sh decrypt call sites for a manual review line, without failing on them.
T6="$SB/t6"; mk_tree "$T6"
printf 'Step 3\n~/.oss/hooks/oss-value.sh decrypt\n' > "$T6/commands/trust.md"
printf '~/.oss/hooks/oss-value.sh decrypt custom\n' > "$T6/commands/oss-custom.md"
run_check "$FULL" "$T6"
if [[ $RC -eq 0 ]] && grep -i 'review' <<<"$OUT" | grep -q 'commands/trust.md:2' \
   && grep -i 'review' <<<"$OUT" | grep -q 'commands/oss-custom.md:1'; then
  pass "lists each oss-value.sh decrypt call site (file:line) for manual review, exit 0"
else fail "indirect call sites listed" "rc=$RC out=$OUT"; fi

# 7. A manifest that is not JSON with a prompts object is refused (never a silent pass).
echo 'not json' > "$SB/bad.json"
run_check "$SB/bad.json" "$T1"; rc_bad=$RC
echo '{"version":1}' > "$SB/noprompts.json"
run_check "$SB/noprompts.json" "$T1"; rc_np=$RC
run_check "$SB/does-not-exist.json" "$T1"; rc_nx=$RC
if [[ -f "$CHECK" && $rc_bad -ne 0 && $rc_np -ne 0 && $rc_nx -ne 0 ]]; then
  pass "refuses an unreadable manifest, non-JSON, or JSON without a prompts object"
else fail "bad manifest refused" "rc_bad=$rc_bad rc_np=$rc_np rc_nx=$rc_nx"; fi

# 8. No manifest argument → usage error, non-zero.
OUT="$(bash "$CHECK" 2>&1)"; RC=$?
if [[ -f "$CHECK" && $RC -ne 0 ]] && grep -qi 'usage' <<<"$OUT"; then
  pass "no manifest argument prints usage and exits non-zero"
else fail "usage" "rc=$RC out=$OUT"; fi

# 9. A tree with no literal fetch at all is refused: an empty scan cannot prove the inventory.
T9="$SB/t9"; mkdir -p "$T9/commands"; echo 'nothing here' > "$T9/commands/a.md"
run_check "$FULL" "$T9"
if [[ -f "$CHECK" && $RC -ne 0 ]]; then
  pass "a tree with no literal fetch fails (an empty scan proves nothing)"
else fail "empty scan" "rc=$RC out=$OUT"; fi

# 10. (ship gate finding G) A key holding a line break is one key: "x<newline>workflows/plan" never makes
#     workflows/plan present.
jq '.prompts["x\nworkflows/plan"] = .prompts["workflows/plan"] | del(.prompts["workflows/plan"])' "$FULL" > "$SB/nl-key.json"
run_check "$SB/nl-key.json" "$T1"
if [[ $RC -eq 1 ]] && grep -q '^MISSING workflows/plan ' <<<"$OUT"; then
  pass "a key with a line break is one key: workflows/plan is still reported missing (exit 1)"
else fail "newline key" "rc=$RC out=$OUT"; fi

# 11. (ship gate finding G) A file with more than one JSON document is refused: a key in a second document never
#     counts as present for the first.
{ cat "$NO_WF"; jq '{prompts: {"workflows/plan": .prompts["commands/plan"], "workflows/build": .prompts["commands/build"]}}' "$FULL"; } > "$SB/two-docs.json"
run_check "$SB/two-docs.json" "$T1"
if [[ $RC -eq 2 ]] && ! grep -q '0 missing' <<<"$OUT"; then
  pass "a manifest file with two JSON documents is refused (exit 2), never '0 missing'"
else fail "two documents refused" "rc=$RC out=$OUT"; fi

# 12. A manifest given by a relative path is still read after the check enters the tree.
OUT="$(cd "$SB" && bash "$CHECK" manifest-full.json "$T1" 2>&1)"; RC=$?
if [[ $RC -eq 0 ]] && ! grep -q '^MISSING ' <<<"$OUT"; then
  pass "a manifest named by a relative path passes when every key is present"
else fail "relative manifest path" "rc=$RC out=$OUT"; fi

# 13. (ship gate round 2, finding 5) A key whose entry is null, or has no string servedHash, is missing: oss-decrypt
#     v1.2.5 refuses to deliver it (default-deny), so it must not count as present.
jq '.prompts["workflows/plan"] = null | .prompts["workflows/build"] = {"hash": .prompts["workflows/build"].hash}
    | .prompts["skills/ui-ux"].servedHash = 5' "$FULL" > "$SB/no-served.json"
run_check "$SB/no-served.json" "$T1"
if [[ $RC -eq 1 ]] && grep -q '^MISSING workflows/plan ' <<<"$OUT" && grep -q '^MISSING workflows/build ' <<<"$OUT" \
   && grep -q '^MISSING skills/ui-ux ' <<<"$OUT" && grep -q '3 missing' <<<"$OUT"; then
  pass "a null entry, an entry without servedHash and a non-string servedHash are each reported missing (exit 1)"
else fail "no string servedHash = missing" "rc=$RC out=$OUT"; fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
