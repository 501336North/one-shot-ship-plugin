#!/bin/bash
#
# oss-scaffold-playwright.sh
# Scaffolds Playwright setup for web projects
#
# Usage: oss-scaffold-playwright.sh [--force]
#

set -e

FORCE=false
if [[ "$1" == "--force" ]]; then
    FORCE=true
fi

# Check if Playwright config already exists
if [[ -f "playwright.config.ts" ]] || [[ -f "playwright.config.js" ]]; then
    if [[ "$FORCE" == "false" ]]; then
        echo '{"success": false, "message": "Playwright configuration already exists. Use --force to overwrite."}'
        exit 0
    fi
fi

# Check if package.json exists
if [[ ! -f "package.json" ]]; then
    echo '{"success": false, "message": "No package.json found. Initialize npm first: npm init -y"}'
    exit 1
fi

# Run Playwright init
echo "Initializing Playwright..."
npm init playwright@latest --yes 2>/dev/null || {
    echo '{"success": false, "message": "Failed to initialize Playwright. Run manually: npm init playwright@latest"}'
    exit 1
}

# Verify setup
if [[ -f "playwright.config.ts" ]] || [[ -f "playwright.config.js" ]]; then
    CONFIG_PATH="playwright.config.ts"
    [[ -f "playwright.config.js" ]] && CONFIG_PATH="playwright.config.js"
    echo "{\"success\": true, \"configPath\": \"${CONFIG_PATH}\", \"message\": \"Playwright initialized successfully\"}"
else
    echo '{"success": false, "message": "Playwright setup did not create expected config file"}'
    exit 1
fi
