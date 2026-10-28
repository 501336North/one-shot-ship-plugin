#!/bin/bash
# oss-semver.sh - SemVer 2.0 precedence for the shell. Source it; don't run it.
#
#   source "$SCRIPT_DIR/oss-semver.sh"
#   oss_semver_cmp 2.1.0-beta.1 2.1.0   # prints -1
#
# Prints -1, 0 or 1 as $1 is lower than, equal to or higher than $2, and returns 0. Returns 2 (nothing printed)
# when either is not X.Y.Z[-prerelease][+build]. A pre-release is lower than its release; pre-release
# identifiers compare left to right, numbers as numbers and below words; build metadata is ignored.
# `sort -V` gets pre-releases wrong (it ranks 2.1.0-beta.1 above 2.1.0), so version gates use this instead.

_OSS_SEMVER_ID='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
_OSS_SEMVER_RE="^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(${_OSS_SEMVER_ID}(\.${_OSS_SEMVER_ID})*))?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$"

oss_semver_cmp() {
    local ap bp i n x y
    local -a a b
    [[ "${1:-}" =~ $_OSS_SEMVER_RE ]] || return 2
    a=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"); ap=${BASH_REMATCH[5]}
    [[ "${2:-}" =~ $_OSS_SEMVER_RE ]] || return 2
    b=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"); bp=${BASH_REMATCH[5]}
    for i in 0 1 2; do
        x=${a[i]}; y=${b[i]}
        if (( x < y )); then echo -1; return 0; fi
        if (( x > y )); then echo 1; return 0; fi
    done
    if [[ -z "$ap" && -z "$bp" ]]; then echo 0; return 0; fi
    if [[ -z "$ap" ]]; then echo 1; return 0; fi    # a release is higher than its pre-releases
    if [[ -z "$bp" ]]; then echo -1; return 0; fi
    local IFS=.; local -a pa=($ap) pb=($bp)
    n=${#pa[@]}; (( ${#pb[@]} > n )) && n=${#pb[@]}
    for (( i = 0; i < n; i++ )); do
        x=${pa[i]:-}; y=${pb[i]:-}
        if [[ -z "$x" ]]; then echo -1; return 0; fi   # fewer identifiers is lower
        if [[ -z "$y" ]]; then echo 1; return 0; fi
        if [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]]; then
            if (( x < y )); then echo -1; return 0; fi
            if (( x > y )); then echo 1; return 0; fi
        elif [[ "$x" =~ ^[0-9]+$ ]]; then echo -1; return 0   # numbers are lower than words
        elif [[ "$y" =~ ^[0-9]+$ ]]; then echo 1; return 0
        elif [[ "$x" < "$y" ]]; then echo -1; return 0
        elif [[ "$x" > "$y" ]]; then echo 1; return 0
        fi
    done
    echo 0
}
