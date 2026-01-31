#!/bin/bash
# ensure-decrypt-cli.sh - Auto-install oss-decrypt binary if missing
#
# This hook provides self-healing for users who don't have the decrypt CLI.
# It checks if the binary exists and downloads it if missing.
#
# Usage:
#   ~/.oss/hooks/ensure-decrypt-cli.sh
#
# Returns:
#   0 - Binary is available (existing or newly installed)
#   1 - Installation failed
#
# Called by commands that need prompt decryption (build, ship, plan, etc.)

set -euo pipefail

OSS_BIN_DIR="${HOME}/.oss/bin"
OSS_DECRYPT="${OSS_BIN_DIR}/oss-decrypt"
GITHUB_RELEASES="https://github.com/501336North/one-shot-ship-plugin/releases/latest/download"

# =============================================================================
# Check if binary already exists
# =============================================================================
if [[ -x "$OSS_DECRYPT" ]]; then
    # Binary exists and is executable - nothing to do
    exit 0
fi

# =============================================================================
# Binary missing - need to install
# =============================================================================
echo "oss-decrypt CLI not found. Installing..."

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

echo "oss-decrypt CLI installed successfully!"
exit 0
