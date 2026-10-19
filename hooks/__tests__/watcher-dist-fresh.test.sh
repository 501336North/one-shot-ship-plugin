#!/bin/bash
# The committed watcher/dist is what customers run: it must be the build of watcher/src.
#
# @behavior A fix made in watcher/src but not rebuilt into watcher/dist never reaches a customer
#           (hooks run watcher/dist/cli/*.js). This guard compiles src with the repo's own tsc
#           and fails if any TRACKED dist .js differs from that build, naming the stale files.
# @business-rule Every src change ships with its rebuilt, committed dist (oss-writer-nofollow:
#           the security fix lives in services/workflow-state, cli/oss-error, queue/manager, ...).
#           cli/chain-trigger.js is excluded: scripts/bundle-cli.js overwrites it with a wrapper.
#
# Usage: ./hooks/__tests__/watcher-dist-fresh.test.sh   (needs `npm ci` in watcher/)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
W="$ROOT/watcher"
TSC="$W/node_modules/.bin/tsc"
echo "Running watcher-dist-fresh test..."
if [[ ! -x "$TSC" ]]; then
    echo "✗ FAIL: typescript not installed ($TSC missing) — run: (cd watcher && npm ci)"
    exit 1
fi
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! "$TSC" -p "$W/tsconfig.json" --outDir "$OUT" --declaration false --declarationMap false >"$OUT.log" 2>&1; then
    echo "✗ FAIL: tsc build failed: $(head -5 "$OUT.log")"; rm -f "$OUT.log"; exit 1
fi
rm -f "$OUT.log"
stale=""; checked=0
while IFS= read -r f; do
    rel="${f#watcher/dist/}"
    [[ "$rel" == cli/chain-trigger.js ]] && continue
    [[ -f "$OUT/$rel" ]] || continue          # not produced by tsc (bundle/wrapper output)
    checked=$((checked + 1))
    cmp -s "$OUT/$rel" "$ROOT/$f" || stale="$stale $rel"
done < <(cd "$ROOT" && git ls-files 'watcher/dist/*.js')
# A new src module imported by tracked dist must itself be tracked (else the import breaks).
missing=""
while IFS= read -r f; do
    rel="${f#watcher/dist/}"
    for dep in $(grep -oE "from '\.{1,2}/[^']+\.js'" "$ROOT/$f" | sed -E "s/from '(.*)'/\1/"); do
        target=$(cd "$(dirname "$ROOT/$f")" && cd "$(dirname "$dep")" 2>/dev/null && pwd)/$(basename "$dep")
        [[ -f "$target" ]] || continue
        (cd "$ROOT" && git ls-files --error-unmatch "${target#"$ROOT"/}" >/dev/null 2>&1) || missing="$missing ${target#"$ROOT"/}"
    done
done < <(cd "$ROOT" && git ls-files 'watcher/dist/cli/*.js' 'watcher/dist/services/*.js' 'watcher/dist/queue/*.js' 'watcher/dist/drain-queue.js')
missing=$(echo "$missing" | tr ' ' '\n' | sort -u | tr '\n' ' ')
if [[ -z "$stale" && -z "${missing// /}" && $checked -gt 0 ]]; then
    echo "✓ PASS: $checked tracked watcher/dist .js files match a fresh build of watcher/src; imports tracked"
    exit 0
fi
[[ -n "$stale" ]] && echo "✗ FAIL: stale watcher/dist (rebuild: cd watcher && npx tsc, then commit):$stale"
[[ -n "${missing// /}" ]] && echo "✗ FAIL: tracked dist imports untracked files: $missing"
[[ $checked -eq 0 ]] && echo "✗ FAIL: no tracked dist files were checked"
exit 1
