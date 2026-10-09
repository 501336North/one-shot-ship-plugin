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
# Pinned release, never "latest": an unrelated release (oss-launch-v2.0.78, 2026-06-28) took GitHub's
# "Latest" without oss-decrypt assets and every new install 404'd. See .oss/dev/active/decrypt-download-pin/.
OSS_DECRYPT_TAG="${OSS_DECRYPT_TAG:-cli-decrypt-v1.2.3}"
if [[ ! "$OSS_DECRYPT_TAG" =~ ^cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: invalid OSS_DECRYPT_TAG '$OSS_DECRYPT_TAG' (expected cli-decrypt-vX.Y.Z)"
    exit 1
fi
GITHUB_RELEASES="https://github.com/501336North/one-shot-ship-plugin/releases/download/${OSS_DECRYPT_TAG}"
# -f: an HTTP error is a failure (not a saved error page); HTTPS only; abort a stalled transfer
# (<1 KB/s for 60 s) without capping total time on slow links.
CURL_OPTS=(-fsSL --proto '=https' --connect-timeout 15 --speed-limit 1024 --speed-time 60)

# Standardized error contract: emit a structured OSSError via the oss-error
# emitter when available (in-band stdout JSON + project workflow.log line).
# Emitter absent or failing → legacy behavior only, never break the hook.
emit_oss_error() {
    local cli=""
    if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/oss-error.js" ]]; then
        cli="${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/oss-error.js"
    else
        # Find latest installed version (version-agnostic); never fail the hook
        cli=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "oss-error.js" -path "*/watcher/dist/cli/*" -type f 2>/dev/null | head -1 || true)
    fi
    [[ -n "$cli" ]] || return 0
    node "$cli" --source "hooks/ensure-decrypt-cli.sh" "$@" 2>/dev/null || true
}

# Minimum version required (1.2.0 adds --verify-manifest, --list-prompts, --category for /oss:trust)
# Must stay <= the version the PINNED binary reports about itself: cli-decrypt-v1.2.3 reports "1.2.1".
# Raising it above that makes every /oss:* command re-download the binary forever.
MINIMUM_VERSION="1.2.1"

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
[[ "$ARCH" == "aarch64" ]] && ARCH="arm64"

# Validate platform
if [[ "$PLATFORM" != "Darwin" && "$PLATFORM" != "Linux" ]]; then
    echo "Error: Unsupported platform: $PLATFORM"
    echo "Supported platforms: Darwin (macOS), Linux"
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    exit 1
fi

if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" ]]; then
    echo "Error: Unsupported architecture: $ARCH"
    echo "Supported architectures: arm64, x64"
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    exit 1
fi

# Download URL
DOWNLOAD_URL="${GITHUB_RELEASES}/oss-decrypt-${PLATFORM}-${ARCH}"

echo "Downloading from: $DOWNLOAD_URL"

# Download to a private temp file beside the final path; it only replaces the installed binary (atomic
# rename) after BOTH hash checks and a run check pass. Unverified bytes are never executable at the final
# path, and a failed update leaves the customer's working binary untouched.
# A SIGKILL'd install (the one signal no trap can catch) leaves its temp file behind: sweep any older than
# an hour, never a concurrent install's fresh one. mktemp creates files 0600.
find "$OSS_BIN_DIR" -maxdepth 1 -type f -name '.oss-decrypt.*' -mmin +60 -delete 2>/dev/null || true
TMP_BIN=$(mktemp "$OSS_BIN_DIR/.oss-decrypt.XXXXXX")
CHECKSUM_FILE=$(mktemp)
trap 'rm -f "$TMP_BIN" "$CHECKSUM_FILE"' EXIT

# Download binary
if ! curl "${CURL_OPTS[@]}" "$DOWNLOAD_URL" -o "$TMP_BIN"; then
    echo "Error: Failed to download oss-decrypt binary"
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    emit_oss_error --code OSS-API-003 --severity HIGH \
        --message "oss-decrypt binary download failed: network unreachable" \
        --retry-eligible true --retry-cost cheap
    exit 1
fi

# =============================================================================
# SECURITY: Verify binary SHA-256 checksum before execution
# Download the .sha256 file and compare against the downloaded binary.
# Fail closed: missing or mismatched checksum = reject the binary.
# =============================================================================
if ! curl "${CURL_OPTS[@]}" "${DOWNLOAD_URL}.sha256" -o "$CHECKSUM_FILE"; then
    echo "[verify] Binary checksum: FAILED — checksum file unavailable"
    rm -f "$CHECKSUM_FILE"
    echo "Error: Could not download checksum file for verification."
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    emit_oss_error --code OSS-API-003 --severity HIGH \
        --message "oss-decrypt checksum download failed: network unreachable" \
        --retry-eligible true --retry-cost cheap
    exit 1
fi

# Extract expected hash from checksum file (format: "<hash>  <filename>")
EXPECTED_HASH=$(head -n1 "$CHECKSUM_FILE" | awk '{print $1}')
rm -f "$CHECKSUM_FILE"

if [[ -z "$EXPECTED_HASH" || ${#EXPECTED_HASH} -ne 64 ]]; then
    echo "[verify] Binary checksum: FAILED — invalid checksum format"
    echo "Error: Checksum file has invalid format."
    exit 1
fi

# Compute actual hash (cross-platform: shasum on macOS, sha256sum on Linux)
if command -v shasum &>/dev/null; then
    ACTUAL_HASH=$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')
elif command -v sha256sum &>/dev/null; then
    ACTUAL_HASH=$(sha256sum "$TMP_BIN" | awk '{print $1}')
else
    echo "[verify] Binary checksum: FAILED — no hash command available"
    echo "Error: Neither shasum nor sha256sum found."
    exit 1
fi

if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]]; then
    echo "[verify] Binary checksum: FAILED — mismatch (expected ${EXPECTED_HASH:0:12}..., got ${ACTUAL_HASH:0:12}...)"
    echo "Error: Binary integrity check failed. The download may have been tampered with."
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    emit_oss_error --code OSS-API-002 --severity HIGH \
        --message "oss-decrypt binary integrity check failed: checksum mismatch" \
        --retry-eligible true --retry-cost cheap
    exit 1
fi

echo "[verify] Binary checksum: verified"

# SECOND METHOD — committed known-good manifest (same standard as ensure-oss-launch.sh). The in-release
# .sha256 above comes from the SAME release as the binary, so a release-write compromise could swap both.
# Require the hash to ALSO match a code-reviewed hash committed in the plugin. Fail closed: no manifest,
# no entry for this artifact, or a mismatch all REJECT. This hook usually runs from the ~/.oss/hooks copy,
# so the manifest is looked up beside it, then in the plugin root recorded by session start.
ARTIFACT="oss-decrypt-${PLATFORM}-${ARCH}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKSUMS="${OSS_DECRYPT_CHECKSUMS:-$SCRIPT_DIR/oss-decrypt-checksums.txt}"
if [[ ! -f "$CHECKSUMS" && -z "${OSS_DECRYPT_CHECKSUMS:-}" && -f "$OSS_DIR/plugin-root" ]]; then
    CHECKSUMS="$(cat "$OSS_DIR/plugin-root")/hooks/oss-decrypt-checksums.txt"
fi
COMMITTED_HASH=$(awk -v a="$ARTIFACT" '$2 == a {print $1}' "$CHECKSUMS" 2>/dev/null | head -n1)
if [[ "$ACTUAL_HASH" != "$COMMITTED_HASH" ]]; then   # an absent entry is empty, never equal
    if [[ -n "$COMMITTED_HASH" ]]; then
        echo "[verify] Committed hash: FAILED — mismatch"
    else
        echo "[verify] Committed hash: FAILED — no committed entry for $ARTIFACT"
    fi
    echo "Error: Binary does not match the plugin's committed checksum. Refusing to install (possible release tamper)."
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    emit_oss_error --code OSS-API-002 --severity HIGH \
        --message "oss-decrypt binary failed committed-manifest verification" \
        --retry-eligible false --retry-cost cheap
    exit 1
fi
echo "[verify] Committed hash: verified"

# Make executable, prove it runs, then atomically replace the installed binary
chmod 755 "$TMP_BIN"
if ! "$TMP_BIN" --version &>/dev/null; then
    echo "Error: Downloaded binary is not valid"
    echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
    emit_oss_error --code OSS-API-002 --severity HIGH \
        --message "oss-decrypt binary is not executable after download" \
        --retry-eligible true --retry-cost cheap
    exit 1
fi
mv -f "$TMP_BIN" "$OSS_DECRYPT"

# Run setup to configure credentials
echo "Running initial setup..."
"$OSS_DECRYPT" --setup || echo "Warning: Setup reported an error."

# Report HONEST status: only claim "ready" when the binary runs AND credentials
# were actually generated. Never print a false "ready" on a failed setup.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_VERSION=$("$OSS_DECRYPT" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
if "$HOOK_DIR/verify-decrypt-setup.sh" >/dev/null 2>&1; then
    echo "oss-decrypt CLI v${NEW_VERSION} ready."
else
    echo "oss-decrypt CLI v${NEW_VERSION} installed, but credential setup did not complete."
    echo "Run /oss:login to finish credential setup."
    # Binary is installed (non-fatal); a later /oss:login can complete setup.
fi
exit 0
