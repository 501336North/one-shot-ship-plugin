#!/bin/bash
# check-manifest-inventory.sh — R-273 release check (step R2): every prompt the plugin fetches by a
# literal name must have a key in the server's prompt manifest.
#
# Usage: scripts/check-manifest-inventory.sh <manifest.json> [tree]
#   tree defaults to this plugin repo. Scans the shipped dirs (commands, agents, skills, hooks),
#   skipping __tests__, for `oss-decrypt --type <t> --name <n>` with literal <t> and <n>.
#   Skips --type custom and non-literal names ("$n", {{id}}, <name>, $NAME).
#   Lists every `oss-value.sh decrypt` call site for manual review (never fails on them).
# Exit: 0 all keys present; 1 a key is missing or no literal fetch was found; 2 usage or bad manifest.
set -uo pipefail

manifest="${1:-}"
[[ -n "$manifest" ]] || { echo "usage: $0 <manifest.json> [tree]" >&2; exit 2; }
tree="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Exactly one JSON document (jq reads every document in a file: a key in a second one must never count).
if [[ "$(jq -s 'length == 1 and (.[0].prompts | type == "object")' "$manifest" 2>/dev/null)" != true ]]; then
  echo "error: $manifest is not a readable JSON manifest (exactly one document) with a prompts object" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -- "$manifest" "$work/manifest.json"   # read below from inside the tree: a relative path would not resolve

cd "$tree" || { echo "error: cannot enter $tree" >&2; exit 2; }
dirs=""
for d in commands agents skills hooks; do [[ -d "$d" ]] && dirs="$dirs $d"; done

literal='^[A-Za-z0-9][A-Za-z0-9._-]*$'
call='--type[[:space:]]+([^[:space:]]+)[[:space:]]+--name[[:space:]]+([^[:space:]]+)'
checked=0
: > "$work/missing"
if [[ -n "$dirs" ]]; then
  # shellcheck disable=SC2086
  grep -rnoE --exclude-dir=__tests__ \
    'oss-decrypt[^[:space:]]{0,2}[[:space:]]+--type[[:space:]]+[^[:space:]]+[[:space:]]+--name[[:space:]]+[^[:space:]]+' \
    $dirs 2>/dev/null > "$work/calls"
  while IFS=: read -r file line match; do
    [[ $match =~ $call ]] || continue
    t="${BASH_REMATCH[1]}"; n="${BASH_REMATCH[2]}"
    t="${t%%[\`\"\'\)\;,\|\]]*}"; n="${n%%[\`\"\'\)\;,\|\]]*}"; n="${n%.}"
    [[ $t =~ $literal && $n =~ $literal ]] || continue
    [[ "$t" == "custom" ]] && continue
    checked=$((checked + 1))
    # Membership inside jq: a key holding a line break is one key, never split into lines. Present only with a string
    # servedHash: oss-decrypt v1.2.5 refuses to deliver any other entry (round 2, finding 5).
    [[ "$(jq --arg k "$t/$n" '(.prompts[$k].servedHash | type) == "string"' "$work/manifest.json" 2>/dev/null)" == true ]] || printf '%s\t%s:%s\n' "$t/$n" "$file" "$line" >> "$work/missing"
  done < "$work/calls"

  # shellcheck disable=SC2086
  grep -rnE --exclude-dir=__tests__ 'oss-value\.sh decrypt' $dirs 2>/dev/null | cut -d: -f1,2 | while read -r site; do
    echo "REVIEW (indirect oss-value.sh decrypt, not checked): $site"
  done
fi

if [[ $checked -eq 0 ]]; then
  echo "error: no literal oss-decrypt --type/--name call found under $tree; nothing was checked" >&2
  exit 1
fi

missing=0
while IFS="$(printf '\t')" read -r key where; do
  echo "MISSING $key ($where)"
  missing=$((missing + 1))
done < <(sort -t "$(printf '\t')" -k1,1 -u "$work/missing")

echo "checked $checked literal fetches; $missing missing key(s)"
[[ $missing -eq 0 ]]
