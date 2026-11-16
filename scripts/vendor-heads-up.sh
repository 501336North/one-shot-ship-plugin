#!/usr/bin/env bash
# Pin the heads-up hook (https://github.com/501336North/heads-up) to a released tag.
# Usage: scripts/vendor-heads-up.sh <heads-up repo path> <tag>
# Copies core/heads-up.mjs as it is at <tag> to hooks/heads-up/heads-up.mjs and writes hooks/heads-up/VENDORED.json
# ({version, tag, sha256}). The copy must never be edited here: change heads-up, release, and vendor again.
# hooks/__tests__/heads-up-vendored.test.sh fails when the copy and VENDORED.json disagree.
set -euo pipefail

repo="${1:?usage: vendor-heads-up.sh <heads-up repo path> <tag>}"
tag="${2:?usage: vendor-heads-up.sh <heads-up repo path> <tag>}"
dest="$(cd "$(dirname "$0")/.." && pwd)/hooks/heads-up"

cd "$repo"
if ! git rev-parse --verify -q "refs/tags/$tag^{commit}" >/dev/null; then
    echo "vendor-heads-up: no tag '$tag' in $repo" >&2
    exit 1
fi

mkdir -p "$dest"
tmp="$(mktemp -d "$dest/.vendor.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
git show "refs/tags/$tag:core/heads-up.mjs" > "$tmp/heads-up.mjs"
git show "refs/tags/$tag:.claude-plugin/plugin.json" > "$tmp/plugin.json"
node -e '
  const fs = require("fs");
  const [dir, tag] = process.argv.slice(1);
  const version = JSON.parse(fs.readFileSync(dir + "/plugin.json", "utf8")).version;
  const sha256 = require("crypto").createHash("sha256").update(fs.readFileSync(dir + "/heads-up.mjs")).digest("hex");
  fs.writeFileSync(dir + "/VENDORED.json", JSON.stringify({ version, tag, sha256 }, null, 2) + "\n");
' "$tmp" "$tag"
mv -f "$tmp/heads-up.mjs" "$dest/heads-up.mjs"
mv -f "$tmp/VENDORED.json" "$dest/VENDORED.json"
echo "vendor-heads-up: pinned heads-up $tag into hooks/heads-up/"
