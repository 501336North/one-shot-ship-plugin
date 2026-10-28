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
UPGRADE_STAMP="${OSS_BIN_DIR}/.decrypt-upgrade-failed"
# Pinned release, never "latest": an unrelated release (oss-launch-v2.0.78, 2026-06-28) took GitHub's
# "Latest" without oss-decrypt assets and every new install 404'd. See .oss/dev/active/decrypt-download-pin/.
# Release channels (ADR-004): the pin follows the plugin's channel. A beta plugin (a version with a pre-release part,
# e.g. 2.1.0-beta.1) pins the beta CLI, which carries the staging signing key, and verifies it against its own
# committed checksum file; a stable plugin keeps the stable pin unchanged. The plugin version is read beside this
# hook, or through ~/.oss/plugin-root when it runs from the ~/.oss/hooks copy.
OSS_DECRYPT_STABLE_TAG="cli-decrypt-v1.2.4"
OSS_DECRYPT_BETA_TAG="cli-decrypt-v1.3.0-beta.1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The plugin root recorded by session start, checked by the one helper that owns that check (`oss-value.sh root`, beside
# this hook in the plugin and in ~/.oss/hooks): not a link, owned by the user, absolute, one line, a folder (SR5).
# Nothing printed (rc 1) when it fails, so a refused root is the same as none: the stable pin, no committed manifest.
plugin_root() { bash "$SCRIPT_DIR/oss-value.sh" root 2>/dev/null; }
PLUGIN_JSON="$SCRIPT_DIR/../.claude-plugin/plugin.json"
if [[ ! -f "$PLUGIN_JSON" ]] && R=$(plugin_root); then PLUGIN_JSON="$R/.claude-plugin/plugin.json"; fi
PLUGIN_VERSION=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$PLUGIN_JSON" 2>/dev/null | head -n1 || true)
if [[ "$PLUGIN_VERSION" == *-* ]]; then
    OSS_DECRYPT_TAG="${OSS_DECRYPT_TAG:-$OSS_DECRYPT_BETA_TAG}"; CHECKSUMS_NAME="oss-decrypt-checksums.beta.txt"
else
    OSS_DECRYPT_TAG="${OSS_DECRYPT_TAG:-$OSS_DECRYPT_STABLE_TAG}"; CHECKSUMS_NAME="oss-decrypt-checksums.txt"
fi
if [[ ! "$OSS_DECRYPT_TAG" =~ ^cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]]; then
    echo "Error: invalid OSS_DECRYPT_TAG '$OSS_DECRYPT_TAG' (expected cli-decrypt-vX.Y.Z or cli-decrypt-vX.Y.Z-pre.N)"
    exit 1
fi
PINNED_VERSION="${OSS_DECRYPT_TAG#cli-decrypt-v}"
GITHUB_RELEASES="https://github.com/501336North/one-shot-ship-plugin/releases/download/${OSS_DECRYPT_TAG}"
# -f: an HTTP error is a failure (not a saved error page); HTTPS only; abort a stalled transfer
# (<1 KB/s for 60 s). First installs have no total-time cap; upgrades over a working binary get one deadline (D6).
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

# Minimum version required. The floor EQUALS the pinned release (cli-decrypt-v1.2.4) so its security
# fixes reach existing installs: v1.2.1-v1.2.3 all report "1.2.1" and are replaced by the verified
# pinned asset on the next /oss:* command (D5). It must NEVER exceed what the pinned binary reports
# about itself ("1.2.4"), or every /oss:* command would re-download the binary forever.
MINIMUM_VERSION="1.2.4"

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
# Returns 0 if $1 >= $2, 1 otherwise. Inputs here are always plain X.Y.Z (the first X.Y.Z of --version, and
# MINIMUM_VERSION), where `sort -V` is exact. Pre-release versions (2.1.0-beta.1) need hooks/oss-semver.sh instead;
# this hook does not source it because its ~/.oss/hooks copy must run on its own.
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
HAVE_RUNNABLE=false

if [[ -x "$OSS_DECRYPT" ]]; then
    # Binary exists — check version. Only a clean `--version` (exit 0) counts; the first X.Y.Z only.
    VERSION_OUT=$("$OSS_DECRYPT" --version 2>/dev/null) || VERSION_OUT=""
    CURRENT_FULL=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?' <<<"$VERSION_OUT" | head -n1 || true)
    CURRENT_VERSION=${CURRENT_FULL%%-*}; CURRENT_VERSION=${CURRENT_VERSION:-0.0.0}
    # A pre-release on either side must match the pin EXACTLY: a beta binary never satisfies a stable pin
    # (sort -V would rank it as its X.Y.Z) and a stable binary never satisfies a beta pin.
    if [[ "$PINNED_VERSION" == *-* || "$CURRENT_FULL" == *-* ]]; then
        [[ "$CURRENT_FULL" == "$PINNED_VERSION" ]] && exit 0
    elif version_gte "$CURRENT_VERSION" "$MINIMUM_VERSION"; then
        exit 0
    fi
    # Soft path (keep it on a failed download) only for a working install at or above the old floor 1.2.1.
    version_gte "$CURRENT_VERSION" "1.2.1" && HAVE_RUNNABLE=true
    # A failed upgrade to THIS tag less than 6 h ago (stamp "<epoch> <tag>", never a symlink): keep the
    # working binary and skip the download, so a slow link does not cost ~100 s on every command.
    if [[ "$HAVE_RUNNABLE" == "true" && -f "$UPGRADE_STAMP" && ! -L "$UPGRADE_STAMP" ]]; then
        read -r STAMP_AT STAMP_TAG _ < "$UPGRADE_STAMP" || true
        # Digits only BEFORE any arithmetic: bash evaluates names (and a[$(cmd)]) inside $(( )).
        [[ "${STAMP_AT:-}" =~ ^[0-9]{1,12}$ ]] || STAMP_AT=""
        STAMP_AGE=$(( $(date +%s) - 10#${STAMP_AT:-0} ))
        if [[ -n "$STAMP_AT" && "${STAMP_TAG:-}" == "$OSS_DECRYPT_TAG" && $STAMP_AGE -ge 0 && $STAMP_AGE -lt 21600 ]]; then
            echo "oss-decrypt update to ${OSS_DECRYPT_TAG} postponed (last attempt failed $((STAMP_AGE / 60)) min ago)" >&2
            exit 0
        fi
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

# D6 soft upgrade: a failed DOWNLOAD (or an asset reporting below the floor) must not take away a working
# older binary. Warn, keep it, exit 0, stamp it (retry after 6 h). Hash mismatches never come here (tamper is hard).
keep_installed_or_fail() {
    if [[ "$HAVE_RUNNABLE" == "true" ]]; then
        echo "oss-decrypt update to ${OSS_DECRYPT_TAG} failed ($1); keeping the installed version; will retry next command" >&2
        # Postpone the next attempt (see the stamp check above). Never follow a symlink; temp file + rename.
        if [[ ! -L "$UPGRADE_STAMP" ]]; then
            local tmp; tmp=$(mktemp "$UPGRADE_STAMP.XXXXXX" 2>/dev/null) || exit 0
            { echo "$(date +%s) ${OSS_DECRYPT_TAG}" > "$tmp" && mv -f "$tmp" "$UPGRADE_STAMP"; } 2>/dev/null || rm -f "$tmp"
        fi
        exit 0
    fi
}
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
# an hour, never a concurrent install's fresh one (curl keeps its mtime current: CURL_OPTS must never
# use -R/--remote-time, which would stamp a live download with the server's old date). mktemp creates 0600.
find "$OSS_BIN_DIR" -maxdepth 1 -type f -name '.oss-decrypt.*' -mmin +60 -delete 2>/dev/null || true
# Trap first, so a failure creating either temp file never leaves the other behind.
TMP_BIN=""; CHECKSUM_FILE=""
trap 'rm -f "$TMP_BIN" "$CHECKSUM_FILE"' EXIT
TMP_BIN=$(mktemp "$OSS_BIN_DIR/.oss-decrypt.XXXXXX")
CHECKSUM_FILE=$(mktemp)

# Download binary ($@ = extra curl options)
fetch_binary() {
    if ! curl "${CURL_OPTS[@]}" "$@" "$DOWNLOAD_URL" -o "$TMP_BIN"; then
        keep_installed_or_fail "download"
        echo "Error: Failed to download oss-decrypt binary"
        echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
        emit_oss_error --code OSS-API-003 --severity HIGH \
            --message "oss-decrypt binary download failed: network unreachable" \
            --retry-eligible true --retry-cost cheap
        exit 1
    fi
}

# =============================================================================
# SECURITY: Verify binary SHA-256 checksum before execution
# Download the .sha256 file and compare against the downloaded binary.
# Fail closed: missing or mismatched checksum = reject the binary.
# =============================================================================
fetch_checksum() {
    if ! curl "${CURL_OPTS[@]}" "$@" "${DOWNLOAD_URL}.sha256" -o "$CHECKSUM_FILE"; then
        keep_installed_or_fail "download"
        echo "[verify] Binary checksum: FAILED — checksum file unavailable"
        rm -f "$CHECKSUM_FILE"
        echo "Error: Could not download checksum file for verification."
        echo "Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."
        emit_oss_error --code OSS-API-003 --severity HIGH \
            --message "oss-decrypt checksum download failed: network unreachable" \
            --retry-eligible true --retry-cost cheap
        exit 1
    fi
}

# The hook runs inside a ~120 s Bash tool call: an upgrade over a working binary gets ONE 100 s deadline for
# both downloads, so a slow link fails inside the hook (and takes the soft path above) before the tool kills
# it. The small .sha256 goes first (15 s), the binary gets the rest. A first install has no cap: it must finish.
if [[ "$HAVE_RUNNABLE" == "true" ]]; then
    DL_START=$SECONDS
    fetch_checksum --max-time 15
    fetch_binary --max-time $((100 - (SECONDS - DL_START)))
else
    fetch_binary
    fetch_checksum
fi

# Extract expected hash from checksum file (format: "<hash>  <filename>")
EXPECTED_HASH=$(head -n1 "$CHECKSUM_FILE" | awk '{print $1}')
rm -f "$CHECKSUM_FILE"

# No hash delivered (empty, or a captive-portal HTML page served with 200) is a failed download, not a
# mismatch: soft when a runnable binary is installed. A well-formed hash that disagrees stays hard below.
if [[ -z "$EXPECTED_HASH" || ${#EXPECTED_HASH} -ne 64 ]]; then
    keep_installed_or_fail "download: checksum file has no hash"
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
CHECKSUMS="${OSS_DECRYPT_CHECKSUMS:-$SCRIPT_DIR/$CHECKSUMS_NAME}"
if [[ ! -f "$CHECKSUMS" && -z "${OSS_DECRYPT_CHECKSUMS:-}" ]] && R=$(plugin_root); then
    CHECKSUMS="$R/hooks/$CHECKSUMS_NAME"
fi
COMMITTED_HASH=$(awk -v a="$ARTIFACT" '$2 == a {print $1}' "$CHECKSUMS" 2>/dev/null | head -n1) || COMMITTED_HASH=""   # no manifest: the message below, not a silent set -e exit
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
# Never install a binary that reports below the floor: the next command would download it again, forever.
DOWNLOADED_VERSION=$("$TMP_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")
if ! version_gte "$DOWNLOADED_VERSION" "$MINIMUM_VERSION"; then
    keep_installed_or_fail "release reports v${DOWNLOADED_VERSION}, below v${MINIMUM_VERSION}"
    echo "Error: Downloaded binary reports v${DOWNLOADED_VERSION}, below the required v${MINIMUM_VERSION}. Refusing to install."
    exit 1
fi
mv -f "$TMP_BIN" "$OSS_DECRYPT"
rm -f "$UPGRADE_STAMP"

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
