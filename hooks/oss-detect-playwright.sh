#!/bin/bash
#
# oss-detect-playwright.sh
# Detects if the current project has Playwright configured
#
# Output: JSON with detection results
# Example: {"detected": true, "configPath": "playwright.config.ts", "version": "1.40.0"}
#

set -e

# Initialize result
detected=false
config_path=""
version=""

# Check package.json for @playwright/test
if [[ -f "package.json" ]]; then
    # Check devDependencies
    if grep -q '"@playwright/test"' package.json 2>/dev/null; then
        detected=true
        version=$(grep -o '"@playwright/test"[[:space:]]*:[[:space:]]*"[^"]*"' package.json | grep -o '"[0-9^~][^"]*"' | tr -d '"' || echo "")
    fi

    # Also check dependencies (some projects put it there)
    if [[ "$detected" == "false" ]] && grep -q '"playwright"' package.json 2>/dev/null; then
        detected=true
        version=$(grep -o '"playwright"[[:space:]]*:[[:space:]]*"[^"]*"' package.json | grep -o '"[0-9^~][^"]*"' | tr -d '"' || echo "")
    fi
fi

# Check for config file
if [[ -f "playwright.config.ts" ]]; then
    config_path="playwright.config.ts"
elif [[ -f "playwright.config.js" ]]; then
    config_path="playwright.config.js"
elif [[ -f "playwright.config.mjs" ]]; then
    config_path="playwright.config.mjs"
fi

# Output JSON
if [[ "$detected" == "true" ]]; then
    echo "{\"detected\": true, \"configPath\": \"${config_path}\", \"version\": \"${version}\"}"
else
    echo "{\"detected\": false, \"configPath\": \"\", \"version\": \"\"}"
fi
