# Sourced by hooks/__tests__/*.test.sh. Not a test itself.
#
# A stand-in for `~/.oss/bin/oss-decrypt --verify-body <key>` (R-273 D12), so hook tests never run the real
# binary (it pins the production manifest key) or touch the network. Like the real one, it hashes the raw stdin
# bytes and exits 0 only when sha256(stdin) equals the fixture servedHash of <key>.
#
# verify_body_stub <file> <dir>
#   Installs the stub at <file>, normally <home>/.oss/bin/oss-decrypt (warmed, see warm-stub.sh; a symlink to it
#   from another sandbox HOME reuses the warm file). On `--verify-body <key>` it
#   saves its stdin to <dir>/verify.stdin, appends <key> to <dir>/verify.calls, and compares sha256(stdin) with
#   the line "<key> <hex>" in <dir>/served-hashes (the fixture manifest; see served_hash). <dir>/verify.exit, when
#   present, is the exit code it returns instead (1, 4, 124, ...). A mismatch exits 1 with one [SECURITY] line on
#   stderr. Any other argv prints usage and exits 1, as oss-decrypt 1.2.4 does for `--verify-body`.
# old_decrypt_stub <file> <dir>
#   Installs a 1.2.4-like oss-decrypt at <file>: no --verify-body; it prints its help on stdout and exits 1. Its stdin is
#   saved to <dir>/verify.stdin too.
# served_hash <dir> <key> <file>
#   Records sha256 of <file>'s bytes as <key>'s servedHash in <dir>/served-hashes (replacing an earlier one).
# sha256_of <file>  - prints the hex sha256 of <file>'s bytes.

source "$(dirname "${BASH_SOURCE[0]}")/warm-stub.sh"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1" | cut -d' ' -f1
    else shasum -a 256 < "$1" | cut -d' ' -f1; fi
}

served_hash() {
    local dir="$1" key="$2" file="$3" h
    h=$(sha256_of "$file") || return 1
    { grep -v "^$key " "$dir/served-hashes" 2>/dev/null; printf '%s %s\n' "$key" "$h"; } > "$dir/served-hashes.new"
    mv -f "$dir/served-hashes.new" "$dir/served-hashes"
}

verify_body_stub() {
    local file="$1" dir="$2"
    mkdir -p "$dir"
    warm_stub "$file" "$(cat << STUB
D='$dir'
if [ "\$#" -ne 2 ] || [ "\$1" != --verify-body ]; then echo "Usage: oss-decrypt --type <type> --name <name>"; exit 1; fi
cat > "\$D/verify.stdin"
printf '%s\n' "\$2" >> "\$D/verify.calls"
if command -v sha256sum >/dev/null 2>&1; then got=\$(sha256sum < "\$D/verify.stdin" | cut -d' ' -f1)
else got=\$(shasum -a 256 < "\$D/verify.stdin" | cut -d' ' -f1); fi
want=\$(grep "^\$2 " "\$D/served-hashes" 2>/dev/null | cut -d' ' -f2)
[ -f "\$D/verify.exit" ] && exit "\$(cat "\$D/verify.exit")"
if [ -n "\$want" ] && [ "\$got" = "\$want" ]; then exit 0; fi
echo "[SECURITY] \$2: the served bytes do not match the signed manifest" >&2
exit 1
STUB
)"
}

old_decrypt_stub() {
    local file="$1" dir="$2"
    mkdir -p "$dir"
    warm_stub "$file" "$(cat << STUB
cat > '$dir/verify.stdin'
echo "Usage: oss-decrypt --type <type> --name <name> [--setup]"
exit 1
STUB
)"
}
