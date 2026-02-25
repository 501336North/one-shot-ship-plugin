#!/bin/bash
#
# oss-detect-formatter.sh
# Detects the project's code formatter from config files.
#
# Output: formatter name/command on stdout, or empty string if none found
# Exit: always 0
#
# Detection priority:
#   1. .prettierrc (any variation) -> "prettier"
#   2. biome.json -> "biome"
#   3. go.mod -> "gofmt"
#   4. pyproject.toml with [tool.black] -> "black"
#   5. rustfmt.toml -> "rustfmt"
#   6. package.json scripts.format -> the command value
#   7. Nothing found -> empty string

set -euo pipefail

# 1. Prettier - check all common config variations
if ls .prettierrc .prettierrc.json .prettierrc.js .prettierrc.cjs .prettierrc.mjs .prettierrc.yaml .prettierrc.yml .prettierrc.toml prettier.config.js prettier.config.cjs prettier.config.mjs 2>/dev/null | head -1 | grep -q .; then
    echo "prettier"
    exit 0
fi

# 2. Biome
if [[ -f "biome.json" ]]; then
    echo "biome"
    exit 0
fi

# 3. Go
if [[ -f "go.mod" ]]; then
    echo "gofmt"
    exit 0
fi

# 4. Black (Python) - check pyproject.toml for [tool.black]
if [[ -f "pyproject.toml" ]] && grep -q '\[tool\.black\]' pyproject.toml 2>/dev/null; then
    echo "black"
    exit 0
fi

# 5. Rustfmt
if [[ -f "rustfmt.toml" ]]; then
    echo "rustfmt"
    exit 0
fi

# 6. Fallback: package.json scripts.format
if [[ -f "package.json" ]]; then
    format_cmd=""
    if command -v jq &>/dev/null; then
        format_cmd=$(jq -r '.scripts.format // empty' package.json 2>/dev/null || true)
    else
        # Fallback: simple grep extraction
        format_cmd=$(grep -o '"format"[[:space:]]*:[[:space:]]*"[^"]*"' package.json 2>/dev/null | sed 's/.*:[[:space:]]*"\(.*\)"/\1/' || true)
    fi
    if [[ -n "$format_cmd" ]]; then
        echo "$format_cmd"
        exit 0
    fi
fi

# 7. Nothing found
echo -n ""
exit 0
