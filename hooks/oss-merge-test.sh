#!/bin/bash -p
# oss-merge-test.sh: the ship merge step's final test (served ship.md Step 6 item 4, ship-team.md 4e command 1), run as
# `~/.oss/hooks/oss-merge-test.sh --v2` (merge-test-hook; D19: no PATH lookup; D26: --v2 marks plugin 2.1.2 or later). It records branch.txt and head.txt,
# tests the tree a squash merge of the branch into GitHub's main produces (npm ci, the build, the tests) in a throwaway
# clone under env -i, removes the clone, and only on success writes tested.txt and prints READY_TO_MERGE; item 4b
# merges. The value folder key is the served one (the git dir alone), so item 4b finds the proof (D6).
# npm in the clone ignores the branch's .npmrc node-options (D23) and runs scripts with /bin/sh, or with the shell the
# root .npmrc script-shell names when it is a standard shell by absolute path (D24), so those keys cannot fake a pass.
# A branch that changes the root .npmrc against main (any key: workspaces, registry...) STOPs before npm runs (D25): the
# tree entry must match main's, and the clone checks out main first (main's own attributes) and then the squash result,
# rewritten as a fresh checkout would write it (the branch's own attributes, so the tests run on exactly the squash
# result), and the .npmrc on disk (bytes, also behind a link, or none, in any letter case) must not change between the two.
# It is checked again before `npm run build` and before `npm test`, so an install or build script that rewrites it STOPs
# (D27); a process the branch leaves running could still race those checks, and branch scripts run here anyway.
# tested.txt holds `v2 <head> <main>`: served item 4b accepts only that form, never an older check's proof (D28).
#
# Exported shell functions named like a builtin or a tool (command, test, rm, git...) must not fake a pass (D8,
# FOLLOWUPS 143/144/153). `-p` keeps BASH_ENV out and stops this shell importing them, but they stay in the environment
# for the child shells git, gh and npm start; removing them here covers both. POSIXLY_CORRECT is a plain assignment,
# which no function can shadow, and in posix mode `unset` is the special builtin even if a function has that name.
POSIXLY_CORRECT=1
unset -f unset command builtin type test printf echo cd pwd set read kill true false exit return trap eval exec export shift git gh mkdir chmod find rm touch cut tr mktemp env printenv cat grep npm sh S
unset POSIXLY_CORRECT
# D26: served item 4 passes --v2, so it can tell this hook from 2.1.1's (which refuses any argument: update the plugin).
[[ $# == 1 && $1 == --v2 ]] || { echo 'STOP: oss-merge-test takes one argument, --v2, exactly as served item 4 writes it; nothing was tested or merged.' >&2; exit 2; }
# PATH keeps only absolute entries outside the repo: an empty or relative entry, or a folder inside the work tree (or,
# from a linked worktree, the main checkout; from a submodule, the superproject) could run a git or npm the repo ships
# (D8, FOLLOWUPS 146; D10). The repo is found as git finds it, builtins only, before any git runs: the first folder up
# whose .git is a real git dir (objects and refs it can enter, and a HEAD git accepts: a link to refs/..., `ref: refs/...` or a hash) or a gitdir file (from a submodule, on up to the repo holding
# it). Any other .git entry on the way up (a folder with a commondir file, a reftable layout, a link) marks a repo
# folder too, and the walk goes on (D18). PATH keeps each folder as resolved when checked, and drops one whose resolved
# name holds a `:`. A worktree of a bare repo
# excludes the bare
# repo, not the folder holding it. Folders are compared as files (-ef), so a // prefix, another letter case or a
# firmlink spelling of the same folder is still caught.
_x=() _w=$(pwd -P) _more=1
while [[ -n $_w && -n $_more ]]; do
    _more=
    _h=; [[ -f $_w/.git/HEAD && ! -L $_w/.git/HEAD ]] && { IFS= read -r _h < "$_w/.git/HEAD" || :; }; _h=${_h%$'\r'}
    _t=; [[ -L $_w/.git/HEAD ]] && _t=$(/usr/bin/readlink "$_w/.git/HEAD")
    if [[ -d $_w/.git && -d $_w/.git/objects && -x $_w/.git/objects && -d $_w/.git/refs && -x $_w/.git/refs ]] && { [[ $_t == refs/* ]] || [[ $_h == 'ref: refs/'* ]] || [[ $_h =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]]; }; then _x+=("$_w")
    elif [[ -f $_w/.git ]] && { IFS= read -r _l < "$_w/.git" || [[ -n $_l ]]; } && [[ $_l == 'gitdir: '* ]]; then
        _x+=("$_w"); _l=${_l%$'\r'}; _d=${_l#gitdir: }; [[ $_d == /* ]] || _d=$_w/$_d
        # a submodule (its git dir under some .git/.../modules/): keep walking up to the repo that holds it
        case $_d in */.git/*modules/*) _more=1 ;; esac
        if [[ -f $_d/commondir ]] && { IFS= read -r _c < "$_d/commondir" || [[ -n $_c ]]; }; then
            _c=${_c%$'\r'}; [[ $_c == /* ]] || _c=$_d/$_c
            if [[ $_c/../.git -ef $_c ]]; then _x+=("$_c/.."); else _x+=("$_c"); fi
        fi
    else [[ -e $_w/.git || -L $_w/.git ]] && _x+=("$_w"); _more=1
    fi
    _w=${_w%/*}
done
# _ir <path>: 0 if the folder (resolved) is one of the excluded folders or inside one, 1 if outside, 2 if it does not
# resolve.
_ir() {
    _i=$(cd -P -- "$1" 2>/dev/null && pwd -P) || return 2
    while :; do
        for _y in "${_x[@]}"; do [[ $_i -ef $_y ]] && return 0; done
        [[ -z $_i || $_i == / ]] && return 1
        _i=${_i%/*}; [[ -n $_i ]] || _i=/
    done
}
_p=$PATH; PATH=
while [[ -n $_p ]]; do
    _e=${_p%%:*}; if [[ $_p == *:* ]]; then _p=${_p#*:}; else _p=; fi
    [[ $_e == /* ]] || continue
    _e=$(cd -P -- "$_e" 2>/dev/null && pwd -P) || continue
    case $_e in *:*) continue ;; esac
    _ir "$_e"; [[ $? == 1 ]] && PATH=${PATH:+$PATH:}$_e
done
[[ -n $PATH ]] || { echo 'STOP: PATH has no absolute entry outside the repo; nothing was tested or merged.' >&2; exit 2; }
# The user's own git, ssh, gh and CA settings pass to host git (D12), but none may name a file or folder inside the
# repo, or the repo would run code (or choose the trust root) for the fetch that carries the login. The check is an
# allowlist (D14). A path setting (git and ssh run askpass as one program path, not through a shell) must be one
# absolute path (a CA folder list: each `:` part) with no `..` segment, outside the repo once symlinks are resolved.
# GIT_SSH_COMMAND is split into words by /bin/sh itself, as git will run it (quotes, $HOME and ~ keep working), from /
# in git's stripped environment, with globbing off; a command chain or a glob (; | & < > $( ` * ? [ { or a newline)
# stops. Each word, and each part of a word that holds spaces (ssh's -o 'Option value'), must be a plain word with no
# / or ~, an absolute or ~/ path, or KEY=one of those, with every path outside the repo. Host git and gh run from /
# (below), so nothing relative reaches the work tree.
_rin() { # 0 if the path, symlinks followed, is inside an excluded folder (a missing path: its nearest existing folder,
    # each link on the way up followed too; over 40 links counts as inside)
    _q=$1 _n=0
    while :; do
        while [[ -L $_q && $_n -lt 40 ]]; do _l=$(/usr/bin/readlink "$_q") || break; [[ $_l == /* ]] || _l=${_q%/*}/$_l; _q=$_l; _n=$((_n + 1)); done
        [[ $_n -lt 40 ]] || return 0
        _ir "$_q"; _r=$?; [[ $_r == 2 && -n $_q && $_q != / ]] || break; _q=${_q%/*}; [[ -n $_q ]] || _q=/
    done
    [[ $_r == 0 ]]
}
_stop() { printf "STOP: %s is not allowed for this step: '%s' is a command chain, a glob, a variable other than \$HOME, a relative or .. path, or a file or folder inside the repo. Nothing was tested or merged. The setting comes from the environment Claude Code was started with: point it outside the repo with absolute paths (ssh options as -o Option=value), or restart Claude Code without it, then run this step again from item 2.\n" "$1" "$2" >&2; exit 2; }
_ckp() { # <var> <path>
    case $2 in /*) ;; *) _stop "$1" "$2" ;; esac
    case /$2/ in */../*|*$'\n'*) _stop "$1" "$2" ;; esac
    ! _rin "$2" || _stop "$1" "$2"
}
_ckw() { # <var> <word> [nested]
    case $2 in
        *[[:space:]]*) [[ -z $3 ]] || _stop "$1" "$2"
            read -r -a _sw <<< "$2"; for _s in "${_sw[@]}"; do _ckw "$1" "$_s" 1; done ;;
        /*) _ckp "$1" "$2" ;;
        '~/'*) _ckp "$1" "$HOME/${2#\~/}" ;;
        *=*) [[ ${2%%=*} != */* && ${2%%=*} != *'~'* ]] || _stop "$1" "$2"; [[ -z ${2#*=} ]] || _ckw "$1" "${2#*=}" "$3" ;;
        */*|*'~'*) _stop "$1" "$2" ;;
    esac
}
for _v in GIT_SSH GIT_ASKPASS SSH_ASKPASS GIT_CONFIG_GLOBAL XDG_CONFIG_HOME GH_CONFIG_DIR GIT_SSL_CAINFO SSL_CERT_FILE CURL_CA_BUNDLE GIT_SSL_CAPATH SSL_CERT_DIR; do
    _x0=$(printenv "$_v") && [[ -n $_x0 ]] || continue
    [[ ${#_x0} -le 4096 ]] || _stop "$_v" "(over 4096 characters)"
    case $_v in
        GIT_SSL_CAPATH|SSL_CERT_DIR) _l=$_x0
            while [[ -n $_l ]]; do _e=${_l%%:*}; if [[ $_l == *:* ]]; then _l=${_l#*:}; else _l=; fi; [[ -z $_e ]] || _ckp "$_v" "$_e"; done ;;
        *) _ckp "$_v" "$_x0" ;;
    esac
done
if _x0=$(printenv GIT_SSH_COMMAND) && [[ -n $_x0 ]]; then
    case $_x0 in *[\;\|\&\<\>\`\*\?\[\{]*|*'$('*|*$'\n'*) _stop GIT_SSH_COMMAND "$_x0" ;; esac
    [[ ${#_x0} -le 4096 ]] || _stop GIT_SSH_COMMAND "(over 4096 characters)"
    # $HOME is the only variable allowed: git runs the command with variables this check does not have (GIT_DIR
    # names the repo's git dir).
    _w=$_x0
    while [[ $_w == *'$HOME'* ]]; do _q=${_w#*'$HOME'}; case $_q in [A-Za-z0-9_]*) _stop GIT_SSH_COMMAND "$_x0" ;; esac; _w=${_w%%'$HOME'*}$_q; done
    [[ $_w != *'$'* ]] || _stop GIT_SSH_COMMAND "$_x0"
    _ws=$(cd / && /usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" /bin/sh -c 'set -f; (set +B) 2>/dev/null && set +B; eval "set -- $1" && printf "%s\n" "$@"' sh "$_x0" 2>/dev/null) || _stop GIT_SSH_COMMAND "$_x0"
    _n=0
    while IFS= read -r _w; do _n=$((_n + 1)); [[ $_n -le 256 ]] || _stop GIT_SSH_COMMAND "(over 256 words)"; _ckw GIT_SSH_COMMAND "$_w"; done <<< "$_ws"
fi
unset _x _w _l _d _c _h _t _p _e _y _i _v _x0 _ws _q _n _r _more _sw _s
# Every git run on the work tree runs the way the tests do: under env -i with the same allowlist, plus the user's own
# git settings (which global config, which ssh, which proxy and CA, where gh keeps its login), so a command the repo's
# .git/config starts (core.fsmonitor, a remote uploadpack, a url insteadOf to ext:: or git://) never sees the caller's
# other secrets, and those are turned off besides (D10). Once the git dir is known (_gd), git runs from / with it named,
# never from the work tree. Only the fetch of main also gets the GitHub login variables, so a login that lives in
# GH_TOKEN keeps working (D12).
_ga=(); for _v in HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy SSH_AUTH_SOCK LANG GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM XDG_CONFIG_HOME GIT_SSH_COMMAND GIT_SSH GIT_SSH_VARIANT GIT_ASKPASS SSH_ASKPASS GH_CONFIG_DIR GIT_SSL_CAINFO GIT_SSL_CAPATH SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE; do if _x=$(printenv "$_v"); then _ga+=("$_v=$_x"); fi; done
_gt=(); for _v in GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN; do if _x=$(printenv "$_v"); then _gt+=("$_v=$_x"); fi; done; unset _v _x
_gc=(-c core.fsmonitor=false -c protocol.allow=never -c protocol.file.allow=always -c protocol.https.allow=always -c protocol.http.allow=always -c protocol.ssh.allow=always -c protocol.ext.allow=never -c remote.origin.uploadpack=git-upload-pack)
_gd=
git() { if [[ -n $_gd ]]; then (cd / && exec /usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" GIT_DIR="$_gd" "${_ga[@]}" git "${_gc[@]}" "$@"); else /usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" "${_ga[@]}" git "${_gc[@]}" "$@"; fi; }
gitf() { (cd / && exec /usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" GIT_DIR="$_gd" "${_ga[@]}" "${_gt[@]}" git "${_gc[@]}" "$@"); }
G=
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES && top=$(git rev-parse --show-toplevel) && cd "$top" >/dev/null && _gd=$(git rev-parse --absolute-git-dir) && V="$HOME/.oss/run" && mkdir -p -m 700 "$V" && test ! -L "$V" && test -O "$V" && chmod 700 "$V" && { find "$V" -mindepth 2 -maxdepth 2 -type f -name '*.txt' -mtime +7 -delete; find "$V" -mindepth 1 -maxdepth 1 -type d -empty -mtime +1 -delete || true; } 2>/dev/null && G="$HOME/.oss/run/$(git rev-parse --absolute-git-dir | git hash-object --stdin | cut -c1-16)" && mkdir -p -m 700 "$G" && test ! -L "$G" && test -O "$G" && chmod 700 "$G" && touch "$G" && rm -f "$G/branch.txt" "$G/tested.txt" && b=$(git symbolic-ref -q HEAD) && case "$b" in refs/heads/*) b=${b#refs/heads/} ;; *) false ;; esac && lc=$(printf %s "$b" | LC_ALL=C tr A-Z a-z) && case "$lc" in ''|head|main|master) false ;; esac && case "$b" in @|heads/*|refs/*|[-+]*) false ;; esac && test "$(git check-ref-format --branch "$b")" = "$b" && test "$(git for-each-ref --format='%(refname)' "refs/heads/$b")" = "refs/heads/$b" && printf '%s\n' "$b" >| "$G/branch.txt" && echo BRANCH_RECORDED &&
S() { printf 'STOP: %s\n' "$*" >&2; return 1; } && unset GH_REPO GH_HOST && { find "$G" -mindepth 1 -maxdepth 1 -type d -name 't.[1-9]*' ! -name '*[!A-Za-z0-9.]*' -mmin +240 | while IFS= read -r d; do p=${d#"$G"/t.}; p=${p%%.*}; case "$d" in "$G"/t.*) ;; *) continue ;; esac; case "$p" in ''|*[!0-9]*) continue ;; esac; kill -0 "$p" || rm -rf "$d"; done || true; } 2>/dev/null && g=$(git rev-parse --git-path info/grafts) && { test ! -e "$g" && test ! -L "$g" && test "$(git rev-parse --is-shallow-repository)" = false || { S 'this repo is shallow or has .git/info/grafts; nothing was tested or merged. Fix that, then run this step again from item 2.'; }; } &&
h=$(git rev-parse --verify "refs/heads/$b") &&
rm -f "$G/head.txt" && printf '%s\n' "$h" >| "$G/head.txt" &&
{ o=$(git config --get-all remote.origin.url) && R=${o#*github.com[/:]} && case "$o" in https://github.com/"$R"|git@github.com:"$R"|ssh://git@github.com/"$R") ;; *) false ;; esac && R=${R%.git} && case "$R" in */*/*|[.-]*|*/[.-]*|*[!A-Za-z0-9/._-]*) false ;; ?*/?*) ;; *) false ;; esac || { S 'origin is not one github.com repository URL; nothing was merged. Fix it, then run this step again from item 2.'; }; } &&
{ m=$(cd / && command gh api "repos/$R/git/ref/heads/main" --jq .object.sha 2>/dev/null) && git -c core.hooksPath=/dev/null update-ref --no-deref -d refs/oss/main && gitf -c core.hooksPath=/dev/null fetch -q --no-tags --no-recurse-submodules origin +refs/heads/main:refs/oss/main && test "$(git rev-parse --verify refs/oss/main)" = "$m" || { S 'main on GitHub could not be read, or origin did not fetch it; nothing was tested or merged. Run this step again from item 2.'; }; } &&
set -- && for v in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy SSH_AUTH_SOCK LANG NODE_EXTRA_CA_CERTS; do if x=$(command printenv "$v"); then set -- "$@" "$v=$x"; fi; done &&
t=$(mktemp -d "$G/t.$$.XXXXXX") && trap 'rm -rf "$t"; rm -f "$G/tested.txt"; exit 130' INT TERM HUP && { command /usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1 XDG_CONFIG_HOME="$t/x" ZDOTDIR="$t/z" npm_config_userconfig="$t/u" npm_config_globalconfig="$t/g" npm_config_script_shell=/bin/sh npm_config_node_options=" " "$@" /bin/sh -c 'S() { printf "STOP: %s\n" "$*" >&2; exit 1; }; N() { if test -L .npmrc; then printf "L%s|" "$(readlink .npmrc)"; fi; if test -f .npmrc; then printf "F%s" "$(git hash-object --no-filters --stdin < .npmrc)"; elif test -e .npmrc; then printf D; else printf N; fi; }; { git clone --no-local --no-checkout --reject-shallow -q -- "$1" "$2/w" && cd "$2/w" && git fetch -q origin refs/oss/main && git cat-file -e "$3^0" && git cat-file -e "$4^0" || S "the throwaway clone failed; nothing was tested or merged. Run this step again from item 2."; } &&
{ r=$(git merge-tree --write-tree "$3" "$4") || S "the branch does not merge cleanly into main, or this git has no merge-tree --write-tree (git 2.38 or later); nothing was tested or merged."; } &&
c=$(git -c user.name=oss -c user.email=oss@localhost commit-tree "$r" -p "$3" -p "$4" -m "oss ship: final test of the squash result") &&
{ git -c core.hooksPath=/dev/null checkout -q --detach "$3" && a=$(N) && git -c core.hooksPath=/dev/null checkout -q --detach "$c" && git rm -rq --cached . && git -c core.hooksPath=/dev/null reset -q --hard "$c" || S "the throwaway checkout failed; nothing was tested or merged. Run this step again from item 2."; } &&
{ test "$(git ls-tree "$3" -- .npmrc)" = "$(git ls-tree "$c" -- .npmrc)" && test "$a" = "$(N)" || S "the branch changes the root .npmrc, which can change how npm runs the final tests; nothing was tested or merged. Review the .npmrc change and merge this PR by hand, or move the .npmrc change into its own reviewed PR, merge that to main first, then run /oss:ship again from the start."; } &&
{ ss=$(sed -n "s/^[[:space:]]*script-shell[[:space:]]*=[[:space:]]*//p" .npmrc 2>/dev/null | tail -n 1 | tr -d "\r" | sed "s/[[:space:]]*\$//"); case "$ss" in /bin/sh|/bin/bash|/bin/zsh|/usr/bin/bash|/usr/bin/zsh|/usr/local/bin/bash|/opt/homebrew/bin/bash) npm_config_script_shell=$ss ;; esac; :; } &&
R() { test "$a" = "$(N)" || S "the root .npmrc changed while npm ran (an install or build script rewrote it), which can change how npm runs the final tests; nothing was tested or merged. Review the branch scripts that write .npmrc."; }; { npm ci && R && npm run build --if-present && R && npm test || S "npm ci, the build or the tests failed; nothing was merged. They saw only PATH, HOME, TMPDIR and any set proxy, SSH_AUTH_SOCK, LANG or NODE_EXTRA_CA_CERTS variable; npm ignored any .npmrc node-options and ran scripts with /bin/sh unless .npmrc names a standard shell. If the fix needs new commits, run /oss:ship again from the start."; }' sh "$top" "$t" "$m" "$h"; e=$?; rm -rf "$t"; test "$e" = 0; } &&
printf 'v2 %s %s\n' "$h" "$m" >| "$G/tested.txt" &&
echo READY_TO_MERGE || {
# Any failure leaves no tested.txt, not even one the tests or a repo command wrote after the one removed above.
[[ -n $G ]] && rm -f "$G/tested.txt"; exit 1; }
