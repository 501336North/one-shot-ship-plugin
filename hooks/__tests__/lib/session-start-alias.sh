# Sourced by hooks/__tests__/*.test.sh. Not a test itself.
#
# session_start_alias <hooks dir> [alias dir]
#   Prints the path to run oss-session-start.sh by, under a name that `pkill -f oss-session-start` does not
#   match. Every checkout older than 225b685 runs that pkill, machine-wide, in its vitest setup, so a test
#   that runs the hook by its real name fails whenever such a run overlaps it (T42, T43;
#   session-start-outside-kill.test.sh). The alias is a symlink next to the hook's siblings, so the hook
#   still sources them from its own folder: with [alias dir], that folder gets a symlink to every file of
#   <hooks dir> first (nothing is copied, so no new executable meets the first-exec scan).
session_start_alias() {
    local src="$1" dir="${2:-$1}" f
    if [[ "$dir" != "$src" ]]; then
        mkdir -p "$dir" || return 1
        for f in "$src"/*; do [[ -e "$dir/${f##*/}" ]] || ln -s "$f" "$dir/${f##*/}" || return 1; done
    fi
    ln -sf oss-session-start.sh "$dir/session-hook-under-test.sh" || return 1
    printf '%s\n' "$dir/session-hook-under-test.sh"
}
