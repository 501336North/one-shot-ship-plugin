# Sourced by hooks/__tests__/*.test.sh. Not a test itself.
#
# warm_stub <file> <body> [on_warm]
#   Writes an executable bash stub and execs the file itself once (warm-up), so the macOS
#   first-exec security scan (0.3 s to ~60 s per new file under load) happens here and not
#   inside a timed check. The warm-up run skips <body>. [on_warm] is called with the marker
#   path the warm-up wrote, before it is deleted. Returns 1 if the warm-up did not run.
warm_stub() {
    local file="$1" body="$2" on_warm="${3:-}" marker="$1.warm"
    mkdir -p "$(dirname "$file")" || return 1
    printf '#!/bin/bash\n%s\n%s\n' '[ -n "${OSS_STUB_WARMUP:-}" ] && { : > "$OSS_STUB_WARMUP"; exit 0; }' "$body" > "$file" || return 1
    chmod 0755 "$file" || return 1
    OSS_STUB_WARMUP="$marker" "$file" </dev/null >/dev/null 2>&1
    [ -f "$marker" ] || return 1
    [ -n "$on_warm" ] && "$on_warm" "$marker"
    rm -f "$marker"
}
