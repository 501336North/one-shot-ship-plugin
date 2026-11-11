#!/bin/bash
# Runs every __tests__/*.test.sh file under ROOT (default: the plugin repo), each alone with /bin/bash and
# no stdin; exits non-zero and names each failing file if any fails. node_modules and .git are never run.
# The repo's `npm test` (D6). Never the watcher's vitest suite: its setup kills OSS processes machine-wide.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
failed=()
while IFS= read -r t; do
    /bin/bash "$t" </dev/null >/dev/null 2>&1 || failed+=("${t#"$ROOT"/}")
done < <(find "$ROOT" \( -name node_modules -o -name .git \) -prune -o -path '*/__tests__/*.test.sh' -type f -print | sort)
if ((${#failed[@]})); then
    printf 'FAILED: %s\n' "${failed[@]}"
    exit 1
fi
echo "All shell test files passed"
