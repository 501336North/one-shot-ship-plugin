#!/bin/bash
# Runs every __tests__/*.test.sh file under ROOT (default: the plugin repo) and exits non-zero naming each failing
# file. The repo's `npm test` (D6). Never the watcher's vitest suite: its setup kills OSS processes machine-wide.
# Each file runs alone, named as it starts, with /bin/bash and no stdin, under `env -i` with a short allow-list
# (PATH, TMPDIR, locale, user, proxies, CA certs; never the SSH agent) and its own empty HOME, in its own process group
# with a time limit (RUN_SHELL_TESTS_TIMEOUT seconds, 1 to 86400, default 1800): at the limit, or when it leaves
# a process behind, the whole group is killed and the file fails (run_capped, hooks/__tests__/lib).
# It also fails when nothing ran, when find fails, or when the tree holds a symlink (find does not follow links,
# so tests behind one would be skipped silently). node_modules and .git are never searched or run.
# The whole body is a function called on the last line, so bash has read all of it before any test runs: a test
# that rewrites this file cannot change what the run does next.
main() {
    set -uo pipefail
    local here root limit t rel rc n=0 v   # list and h stay global: the EXIT trap removes them after main returns
    local -a failed=() keep=()
    here="$(CDPATH='' cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    root="${1:-$here/..}"
    limit="${RUN_SHELL_TESTS_TIMEOUT:-1800}"
    if [[ ! "$limit" =~ ^[1-9][0-9]{0,4}$ ]] || ((limit > 86400)); then
        echo "FAILED: RUN_SHELL_TESTS_TIMEOUT must be a whole number of seconds from 1 to 86400"
        return 1
    fi
    root="$(CDPATH='' cd -- "$root" 2>/dev/null && pwd)" || { echo "FAILED: no such folder: ${1:-}"; return 1; }
    # shellcheck source=../hooks/__tests__/lib/run-capped.sh
    source "$here/../hooks/__tests__/lib/run-capped.sh" || { echo "FAILED: run-capped.sh is missing"; return 1; }

    # fetch-fallback.test.sh runs the installed oss-decrypt (it refuses one whose SHA-256 is not pinned); each test
    # file gets its own HOME, so point it at the real home's copy unless the caller chose one.
    keep=("OSS_DECRYPT_UNDER_TEST=${OSS_DECRYPT_UNDER_TEST:-$HOME/.oss/bin/oss-decrypt}")
    for v in PATH TMPDIR LANG LC_ALL LC_CTYPE USER LOGNAME SHELL TERM NODE_EXTRA_CA_CERTS \
        HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
        [[ -n "${!v+x}" ]] && keep+=("$v=${!v}")
    done

    list="$(mktemp)" || { echo "FAILED: mktemp failed"; return 1; }
    h=
    trap 'rm -f -- "$list"; [[ -z "${h:-}" ]] || rm -rf -- "$h"' EXIT
    local -a prune=(\( -name node_modules -o -name .git \) -prune -o)

    find "$root" "${prune[@]}" -type l -print0 > "$list" || failed+=("find could not search $root")
    while IFS= read -r -d '' t; do failed+=("${t#"$root"/} (a symlink: tests behind it would not run)"); done < "$list"

    find "$root" "${prune[@]}" -path '*/__tests__/*.test.sh' -type f -print0 > "$list" || failed+=("find could not search $root")
    # The whole sorted list is read before any test runs (ship round 4): a test that kills a still-running sort
    # (or truncates the list file) cannot cut the run short and leave the files after it unrun.
    sort -z -o "$list" "$list" || { echo "FAILED: could not sort the test file list"; return 1; }
    local -a files=()
    while IFS= read -r -d '' t; do files+=("$t"); done < "$list"
    for t in ${files[@]+"${files[@]}"}; do
        n=$((n + 1))
        rel="${t#"$root"/}"
        echo "== $rel"
        h="$(mktemp -d)" || { h=; failed+=("$rel (no HOME: mktemp -d failed; not run)"); continue; }
        run_capped "$limit" env -i "${keep[@]}" HOME="$h" /bin/bash "$t" </dev/null >/dev/null 2>&1
        rc=$?
        rm -rf -- "$h"; h=
        case "$rc" in
            0) ;;
            "$RUN_CAPPED_CAP_RC") failed+=("$rel (stopped at the $limit s time limit)") ;;
            "$RUN_CAPPED_LEAK_RC") failed+=("$rel (left a process running; it was killed)") ;;
            *) failed+=("$rel") ;;
        esac
    done
    ((n > 0)) || failed+=("no __tests__/*.test.sh file found under $root")

    if ((${#failed[@]})); then
        printf 'FAILED: %s\n' "${failed[@]}"
        return 1
    fi
    echo "All $n shell test files passed"
}
main "$@"; exit $?
