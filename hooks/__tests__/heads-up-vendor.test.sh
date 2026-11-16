#!/usr/bin/env bash
# @behavior A maintainer pins the heads-up hook to a released tag with one command, and gets exactly that release.
# @business-rule scripts/vendor-heads-up.sh <heads-up repo> <tag> copies core/heads-up.mjs as it is at the tag (not
#   the working copy) to hooks/heads-up/heads-up.mjs and writes hooks/heads-up/VENDORED.json with the tag's version,
#   the tag and the copy's sha256; an unknown tag is refused and changes nothing (US-007, AC-007.2).
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

# A heads-up repo with a release tag, then an unreleased change on top (committed and uncommitted).
repo="$work/heads-up"
mkdir -p "$repo/core" "$repo/.claude-plugin"
g() { (cd "$repo" && git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false -c tag.gpgsign=false "$@") >/dev/null 2>&1; }
g init -q
printf '// released hook %s\n' "$$" > "$repo/core/heads-up.mjs"
printf '{ "name": "heads-up", "version": "7.3.1" }\n' > "$repo/.claude-plugin/plugin.json"
g add -A; g commit -q -m release; g tag v7.3.1
released="$(cat "$repo/core/heads-up.mjs")"
printf '// unreleased\n' > "$repo/core/heads-up.mjs"; g commit -q -am next
printf '// dirty\n' > "$repo/core/heads-up.mjs"

# A copy of the plugin layout, so the script writes into the temp copy, never into this repo.
plugin="$work/plugin"
mkdir -p "$plugin/scripts"
cp "$DIR/scripts/vendor-heads-up.sh" "$plugin/scripts/" 2>/dev/null
vendored="$plugin/hooks/heads-up/heads-up.mjs"
pin="$plugin/hooks/heads-up/VENDORED.json"
field() { node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]))' "$pin" "$1" 2>/dev/null; }
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }

bash "$plugin/scripts/vendor-heads-up.sh" "$repo" v7.3.1 >/dev/null 2>&1; rc=$?
check "vendoring a real tag succeeds" '[ "$rc" -eq 0 ]'
check "the copy is the file as it is at the tag" '[ "$(cat "$vendored" 2>/dev/null)" = "$released" ]'
check "VENDORED.json names the tag's version" '[ "$(field version)" = "7.3.1" ]'
check "VENDORED.json names the tag" '[ "$(field tag)" = "v7.3.1" ]'
check "VENDORED.json holds the copy's sha256" '[ -f "$vendored" ] && [ "$(field sha256)" = "$(sha "$vendored")" ]'

before_copy="$(cat "$vendored" 2>/dev/null)"; before_pin="$(cat "$pin" 2>/dev/null)"
bash "$plugin/scripts/vendor-heads-up.sh" "$repo" v0.0.0-nope >/dev/null 2>&1; rc=$?
check "an unknown tag is refused" '[ "$rc" -ne 0 ]'
check "an unknown tag leaves the copy unchanged" '[ "$(cat "$vendored" 2>/dev/null)" = "$before_copy" ]'
check "an unknown tag leaves VENDORED.json unchanged" '[ "$(cat "$pin" 2>/dev/null)" = "$before_pin" ]'

echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
