#!/bin/bash
# Live check for R-266 round 9 (D-R9-1): inside the review sandbox a real internet name still
# resolves and an HTTPS request still gets through. Run by hand on macOS; needs the internet.
# Not run by vitest (it only picks up *.test.ts): the hermetic tests in
# test/tool-gate/sandbox.integration.test.ts prove TCP (a local server) and name lookup through
# mDNSResponder (this Mac's own .local name) without the internet.
#
# Usage: bash watcher/test/live/sandbox-network.live.sh [url]   (default https://registry.npmjs.org)

set -uo pipefail

[[ "$(uname)" == "Darwin" ]] || { echo "SKIP: macOS only"; exit 0; }
WATCHER="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${1:-https://registry.npmjs.org}"
WORK="$(mktemp -d -t oss-sbx-live.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home" "$WORK/priv" && chmod 700 "$WORK/priv"

# the same profile the gate builds, for a throwaway home and private folder
PROFILE="$(cd "$WATCHER" && npx --no-install tsx -e '
  import { reviewSandboxProfile } from "./src/tool-gate/sandbox.ts";
  const [home, priv] = process.argv.slice(1);
  process.stdout.write(reviewSandboxProfile({ homes: [home], privateDir: priv, repos: [] }));
' "$WORK/home" "$WORK/priv")" || { echo "FAIL: could not build the profile"; exit 1; }

CODE="$(/usr/bin/sandbox-exec -p "$PROFILE" /usr/bin/curl -sI -o /dev/null -w '%{http_code}' --max-time 60 "$URL")"
if [[ "$CODE" =~ ^[23][0-9][0-9]$ ]]; then
  echo "PASS: $URL answered $CODE inside the review sandbox"
else
  echo "FAIL: $URL answered '$CODE' inside the review sandbox (000 = no name or no connection)"
  exit 1
fi
