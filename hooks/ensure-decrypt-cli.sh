#!/bin/bash
# ensure-decrypt-cli.sh - Auto-install/update oss-decrypt binary
#
# This hook provides self-healing for users who don't have the decrypt CLI
# or have an outdated version missing critical security features.
#
# Usage:
#   ~/.oss/hooks/ensure-decrypt-cli.sh
#
# Returns:
#   0 - Binary is available and meets minimum version
#   1 - Installation failed
#
# Called by commands that need prompt decryption (build, ship, plan, etc.)

set -euo pipefail

OSS_DIR="${HOME}/.oss"
OSS_BIN_DIR="${OSS_DIR}/bin"
OSS_DECRYPT="${OSS_BIN_DIR}/oss-decrypt"
GITHUB_RELEASES="https://github.com/501336North/one-shot-ship-plugin/releases/latest/download"

# Minimum version required (1.1.0 adds signature verification)
MINIMUM_VERSION="1.1.0"

# =============================================================================
# SECURITY: One-time cleanup of legacy prompt caches (v2.0.19+)
# This runs ONCE per user to remove any previously cached plaintext prompts.
# A marker file tracks that cleanup was done so we don't repeat unnecessarily.
# =============================================================================
CACHE_CLEANUP_MARKER="${OSS_DIR}/.cache-cleanup-done-2.0.19"

if [[ ! -f "$CACHE_CLEANUP_MARKER" ]]; then
    # Remove legacy cache directories (both cli-decrypt and watcher caches)
    rm -rf "${OSS_DIR}/prompt-cache" 2>/dev/null || true
    rm -rf "${OSS_DIR}/cache/prompts" 2>/dev/null || true

    # Create marker so we only do this once
    mkdir -p "$OSS_DIR"
    touch "$CACHE_CLEANUP_MARKER"
fi

# =============================================================================
# Version comparison helper
# Returns 0 if $1 >= $2 (semver), 1 otherwise
# =============================================================================
version_gte() {
    # printf each version on its own line, sort with version-sort, take first
    # If $2 comes first (or equals $1), then $1 >= $2
    local sorted
    sorted=$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)
    [[ "$sorted" == "$2" ]]
}

# =============================================================================
# Check if binary exists AND meets minimum version
# =============================================================================
NEEDS_INSTALL=false

if [[ -x "$OSS_DECRYPT" ]]; then
    # Binary exists — check version
    CURRENT_VERSION=$("$OSS_DECRYPT" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")
    if version_gte "$CURRENT_VERSION" "$MINIMUM_VERSION"; then
        exit 0
    fi
    echo "oss-decrypt v${CURRENT_VERSION} is outdated (requires >= v${MINIMUM_VERSION}). Updating..."
    NEEDS_INSTALL=true
else
    NEEDS_INSTALL=true
fi

if [[ "$NEEDS_INSTALL" != "true" ]]; then
    exit 0
fi

# =============================================================================
# Binary missing or outdated - install/update
# =============================================================================
if [[ -x "$OSS_DECRYPT" ]]; then
    echo "Updating oss-decrypt CLI..."
else
    echo "oss-decrypt CLI not found. Installing..."
fi

# Create bin directory if needed
mkdir -p "$OSS_BIN_DIR"

# Detect platform
PLATFORM=$(uname -s)
ARCH=$(uname -m)

# Normalize architecture name
[[ "$ARCH" == "x86_64" ]] && ARCH="x64"

# Validate platform
if [[ "$PLATFORM" != "Darwin" && "$PLATFORM" != "Linux" ]]; then
    echo "Error: Unsupported platform: $PLATFORM"
    echo "Supported platforms: Darwin (macOS), Linux"
    echo "Please run /oss:login for manual installation."
    exit 1
fi

if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" ]]; then
    echo "Error: Unsupported architecture: $ARCH"
    echo "Supported architectures: arm64, x64"
    echo "Please run /oss:login for manual installation."
    exit 1
fi

# Download URL
DOWNLOAD_URL="${GITHUB_RELEASES}/oss-decrypt-${PLATFORM}-${ARCH}"

echo "Downloading from: $DOWNLOAD_URL"

# Download binary
if ! curl -sL "$DOWNLOAD_URL" -o "$OSS_DECRYPT"; then
    echo "Error: Failed to download oss-decrypt binary"
    echo "Please check your network connection or run /oss:login for manual installation."
    exit 1
fi

# Make executable
chmod +x "$OSS_DECRYPT"

# Verify it runs
if ! "$OSS_DECRYPT" --version &>/dev/null; then
    echo "Error: Downloaded binary is not valid"
    rm -f "$OSS_DECRYPT"
    echo "Please run /oss:login for manual installation."
    exit 1
fi

# Run setup to configure credentials
echo "Running initial setup..."
if ! "$OSS_DECRYPT" --setup; then
    echo "Warning: Setup failed. You may need to run /oss:login to configure credentials."
    # Don't exit with error - binary is installed, setup can be done later
fi

NEW_VERSION=$("$OSS_DECRYPT" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
echo "oss-decrypt CLI v${NEW_VERSION} ready."
exit 0
