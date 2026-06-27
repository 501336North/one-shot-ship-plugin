#!/usr/bin/env bash
#
# ensure-oss-launch.sh — fetch + verify + cache the self-contained oss-launch binary for this
# OS/arch, so per-agent local routing works with NO system Node. Mirrors ensure-decrypt-cli.sh.
#
# Idempotent: if the binary is already cached, this is a no-op. Fail-closed on checksum mismatch.
# Best-effort: callers should tolerate a non-zero exit (the shim falls back to system node, then
# to a loud all-cloud warning).
#
# Test seams: OSS_LAUNCH_BIN_DIR, OSS_LAUNCH_OS, OSS_LAUNCH_ARCH, OSS_LAUNCH_RELEASES_URL,
# OSS_LAUNCH_FORCE (re-install even if present).
set -uo pipefail

BIN_DIR="${OSS_LAUNCH_BIN_DIR:-$HOME/.oss/bin}"
RELEASES="${OSS_LAUNCH_RELEASES_URL:-https://github.com/501336North/one-shot-ship-plugin/releases/latest/download}"

# Detect OS + arch (overridable for tests).
OS="${OSS_LAUNCH_OS:-$(uname -s)}"
ARCH="${OSS_LAUNCH_ARCH:-$(uname -m)}"
case "$ARCH" in
  aarch64|arm64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
esac

if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  echo "[ensure-oss-launch] unsupported OS: $OS" >&2
  exit 1
fi
if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" ]]; then
  echo "[ensure-oss-launch] unsupported arch: $ARCH" >&2
  exit 1
fi

# The shim looks for this arch-only name (one OS per box).
TARGET="$BIN_DIR/oss-launch-$ARCH"

# Idempotent: already installed.
if [[ -x "$TARGET" && -z "${OSS_LAUNCH_FORCE:-}" ]]; then
  exit 0
fi

mkdir -p "$BIN_DIR"

URL="$RELEASES/oss-launch-$OS-$ARCH"
TMP="$(mktemp)"
SUM="$(mktemp)"
cleanup() { rm -f "$TMP" "$SUM"; }
trap cleanup EXIT

if ! curl -sfL "$URL" -o "$TMP"; then
  echo "[ensure-oss-launch] download failed: $URL" >&2
  exit 1
fi

if ! curl -sfL "$URL.sha256" -o "$SUM"; then
  echo "[ensure-oss-launch] checksum file unavailable — refusing (fail closed)" >&2
  exit 1
fi

# Compute the actual hash (shasum on macOS, sha256sum on Linux) and compare fail-closed.
expected="$(awk '{print $1}' "$SUM")"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$TMP" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TMP" | awk '{print $1}')"
else
  echo "[ensure-oss-launch] no shasum/sha256sum available — refusing" >&2
  exit 1
fi

if [[ -z "$expected" || "$expected" != "$actual" ]]; then
  echo "[ensure-oss-launch] checksum MISMATCH for $URL — rejecting binary" >&2
  exit 1
fi

# Atomic install + executable.
chmod +x "$TMP"
mv "$TMP" "$TARGET"
trap - EXIT
rm -f "$SUM"
echo "[ensure-oss-launch] installed $TARGET" >&2
exit 0
