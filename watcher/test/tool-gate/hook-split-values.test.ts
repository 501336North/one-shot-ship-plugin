/**
 * @behavior The main agent and builders can't run an OSS hook script with a variable they chose by keeping only
 *   the program in a variable and writing the rest after it (`c=env; $c BASH_ENV=… <hook>`, `"$c"`, `"$@"` after
 *   `set --`), by hiding the call in a default (`${c:-env HOME=… <hook>}`), by splitting it across two variables
 *   (`$c $d`), or by keeping it where the gate can't read the value (an array element, a heredoc `read`,
 *   `mapfile` / `readarray`) on a line that names a hook path. A program kept in a variable with a plain value,
 *   a default with a plain program, and an unreadable value on a line with no hook path stay allowed.
 * @business-rule gate-gaps-r3 ship round 1, S2 (owner pick "Blunt fix in this PR"): a program word that is an
 *   expansion is judged as its value plus the rest of the part's words.
 * @boundary runToolGate (the gate as the hook calls it), in a scratch plugin checkout with a scratch home, on darwin and linux.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-split-values-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  // a plugin checkout: its `hooks/` scripts are OSS hooks
  fs.mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"name":"oss"}\n');
  fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'hook-split-values',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

const REFUSED = [
  // the program in a variable, the rest written after it
  'c=env; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; "$c" BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'set -- env BASH_ENV=/tmp/x ./hooks/oss-log.sh; "$@"',
  'set -- env BASH_ENV=/tmp/x ./hooks/oss-log.sh; $*',
  // a default counts as the value
  '${c:-env HOME=/x ~/.oss/hooks/oss-log.sh} init',
  '${c:=env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh} init',
  '${c:-env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh} init',
  // split across two variables
  'c=env; d="HOME=/x $HOME/.oss/hooks/oss-log.sh"; $c $d init',
  'c=env; d="BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; $c $d init',
  // a value the gate can't read, on a line that names a hook path
  'a[0]=env; a[1]=BASH_ENV=/x; a[2]=~/.oss/hooks/oss-log.sh; "${a[@]}" init',
  "read -r c <<'EOF'\nenv BASH_ENV=/x /h/.oss/hooks/oss-log.sh\nEOF\n$c init",
  'mapfile -t a <<< "env BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; ${a[0]} init',
  'readarray -t a <<< "env BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; ${a[0]} init',
];

/** Ship fix round 2, R2-4: any other `${…}` operator on the program word is unreadable, refused on a line naming a hook path. */
const OTHER_OPERATORS = [
  'c=1; HOME=/tmp/x ${c:+~/.oss/hooks/oss-log.sh}',
  'c=1; HOME=/tmp/x ${c:+~/.oss}/hooks/oss-log.sh',
  'c=env; ${c%%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'x=1; ${x:+env} BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'c=env; ${c/q/} BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'c=env; ${c+env} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c#} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c##z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c//q/} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c:0} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c:?} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c^} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c,} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=ENV; ${(L)c} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  // ship fix round 3, R3-4: a default or a suffix removal followed by a rest is read, and judged as a path
  'HOME=/x "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/oss-log.sh"',
  'BASH_ENV=/tmp/x ${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh',
  'c=1; HOME=/tmp/x ${c:-~/.oss}/hooks/oss-log.sh',
  'c=~/.oss/; HOME=/tmp/x ${c%/}/hooks/oss-log.sh',
  'c=envz; ${c%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c%%*z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  // ship fix round 4, R4-1 ("Exact served shapes only"): any other default or suffix form is unreadable again
  '${q%x}env BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; x=z; ${c%$x} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; ${c%"z"} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; ${c%(z)} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'd=env; ${c:-$d} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-}$(echo env) BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c-}/usr/bin/env BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${q%x}env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'HOME=/x ${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh',
  'BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/oss-log.sh"',
  // ship fix round 5, R5-1 F3: `$HOME` needs a name boundary
  '"${CLAUDE_PLUGIN_ROOT:-$HOMEX/.claude/plugins/oss}/hooks/oss-log.sh"',
  'HOMEX=/tmp/x; "${CLAUDE_PLUGIN_ROOT:-$HOMEX/.claude/plugins/oss}/hooks/oss-log.sh"',
  '"${CLAUDE_PLUGIN_ROOT:-$HOME_X/.claude/plugins/oss}/hooks/oss-log.sh"',
];

/** Ship fix round 5, R5-2 (HIGH): a program whose basename is `env`, by path, glob or variable value, counts as `env`. */
const ENV_BY_PATH = [
  '${c:-/usr/bin/env} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=/usr/bin/env; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/env} BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '${c:-/bin/env} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=/bin/env; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/e?v} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/en[v]} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/u*/bin/env} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/env} -i ./hooks/oss-log.sh init',
  '${c:-/usr/bin/env} BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  // the literal path already counts as env: kept refused
  '/usr/bin/env BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '/usr/bin/en? BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  // ship fix round 6, R6-2 (A/F2): the gate's glob matcher, any case; a bracket form it can't read counts as a match
  '/usr/bin/[[:alpha:]]nv BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '/usr/bin/[[:lower:]]nv -i ./hooks/oss-log.sh init',
  '${c:-/usr/bin/[[:alpha:]]nv} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/[^a]nv} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/[!a]nv} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/[d-f]nv} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-/usr/bin/[]e]nv} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=/usr/bin/[^a]nv; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '/usr/bin/[]e]nv -i "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '/usr/bin/[[=e=]]nv -i "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '/usr/bin/[[.e.]]nv -i "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  // on macOS `ENV` and `Env` run env (a case-insensitive file system)
  '/usr/bin/ENV BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '/usr/bin/Env -i ./hooks/oss-log.sh init',
  '/USR/BIN/ENV -i ./hooks/oss-log.sh init',
  '${c:-/usr/bin/ENV} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=/usr/bin/ENV; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '/usr/bin/E?V -i ./hooks/oss-log.sh init',
  '/usr/bin/[E]NV -i ./hooks/oss-log.sh init',
];

/** Ship fix round 6, R6-3: macOS `arch -e NAME=VALUE` sets a variable for the program it runs, as `env` does. */
const ARCH_SETS = [
  'arch -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'arch -arm64 -e CLAUDE_PLUGIN_ROOT=/tmp/p "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '/usr/bin/arch -arm64 -e BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'arch -e BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
];

/** Ship fix round 7, R7-2 ("Blunt on hook lines"): env and arch read in every place they can start a program. */
const HOOK_ENV_BLUNT = [
  // N1: a wrapper before a glob env in a split value (zsh `$=~c`, `$~=c`, `$~c` included)
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x"; $c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x"; $c ~/.oss/hooks/oss-log.sh init',
  'c="nohup /usr/bin/[e]nv -i"; $c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="command /usr/bin/en* BASH_ENV=/tmp/x"; $c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x"; $~c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x"; $=~c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x"; $~=c "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'c="nice /usr/bin/e?v BASH_ENV=/tmp/x ${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh"; $c init',
  // O2: a command substitution as the program word, quoted or not
  '$(command -v env) BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  '`command -v env` BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  '"$(command -v env)" BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  '"`echo env`" PATH=/tmp/b ~/.oss/hooks/oss-log.sh init',
  '"$(printf env)" BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '"$(command -v arch)" -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  // N3: arch by glob, any case, through a variable, a default or a split value
  '/usr/bin/a?ch -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  '/usr/bin/a?ch -arm64 -e BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  '/usr/bin/ARCH -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'a=arch; $a -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'a=/usr/bin/arch; $a -arm64 -e BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  '${c:-/usr/bin/a?ch} -arm64 -e BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  "c='arch -arm64 -e BASH_ENV=/tmp/x'; $c \"${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh\" init",
  // O3: env after arch or launchctl, which run the program after them
  'arch -arm64 env BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'arch -arm64 /usr/bin/env BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  'arch -arm64 env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'launchctl asuser 501 env BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh" init',
  // R7-2 restore (refused at ec6ba2df): arch running a hook path stays refused now that arch is unwrapped
  '/usr/bin/arch -arm64 ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 -e FOO ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 -d BASH_ENV ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 -eBASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 -c ~/.oss/hooks/oss-log.sh init',
  // R7-2 owner-accepted refusal (allowed again under R6-2 E): a split piece that globs to env
  'c="$X ~/.oss/hooks/oss-log.sh * -x"; echo ok',
];

/**
 * Ship fix round 8, R8-1 ("stop unwrapping, refuse blunt"): arch and launchctl are plain programs again, and a part
 * run by either (any spelling) whose words name a hook path, the plugin hook form or env is refused. These are the
 * round-7 regressions (refused at ec6ba2df, allowed once arch and launchctl were read as wrappers).
 */
const ARCH_LAUNCHCTL_BLUNT = [
  "arch -e BASH_ENV=/tmp/x -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -eBASH_ENV=/tmp/x -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -e PATH=/tmp/b -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -e HOME=/tmp/h -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -e CLAUDE_PLUGIN_ROOT=/tmp/p -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -d HOME -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -c -arm64e ~/.oss/hooks/oss-log.sh init",
  "/usr/bin/arch -c -arm64e ~/.oss/hooks/oss-log.sh init",
  "arch -c -arm64e \"$HOME/.oss/hooks/oss-log.sh\" init",
  "arch -arm64e ~/.oss/hooks/oss-log.sh init",
  "printf x | arch -arm64e tee cat .git/config",
  "arch -arm64e cp cat .claude/settings.json",
  "arch -arm64e cp cat ~/.gitconfig",
  // R8-1 follow-up pick "Also refuse git under them": git under arch or launchctl stays refused, as in round 7
  'arch -arm64 git push origin HEAD:main',
  'arch -x86_64 git push origin main',
  'arch git config protocol.ext.allow always',
  'arch -arm64e git git push origin HEAD:main',
  'arch -arm64e cat git push origin HEAD:main',
  'launchctl asuser 501 git push origin main',
  'launchctl bsexec 1 git config core.hooksPath /tmp/x',
  'launchctl submit -l x -- git push origin HEAD:main',
  // owner-accepted refusal
  'arch -x86_64 git status',
  'arch -arm64 git tag -d v1',
  // the gate's git spellings count
  "arch -arm64 g''it push origin HEAD:main",
  'arch -arm64 /usr/bin/git push origin HEAD:main',
  'arch -arm64 \\git push origin HEAD:main',
  'arch -arm64 command git push origin HEAD:main',
  // R8-1 second follow-up pick "Refuse protected-path mentions": a protected path anywhere in its words, -c text included
  'arch -arm64e cat sh -c "cp cat ~/.claude/settings.json"',
  "arch -x86_64 /bin/zsh -c 'cp /tmp/x .git/config'",
  "launchctl asuser 501 sh -c 'echo x > .oss/tool-gates.json'",
  "launchctl submit -l cat -- ~/.oss/hooks/oss-log.sh init",
  "launchctl setenv BASH_ENV /tmp/x; launchctl submit -l cat -- ~/.oss/hooks/oss-log.sh init",
  "launchctl submit -l cat -- /bin/bash ~/.oss/hooks/oss-log.sh init",
  "launchctl submit -l cat -- cp /tmp/c ~/.gitconfig",
  "launchctl submit -l cat -- tee .git/config",
  "launchctl submit -l ls -- rm ~/.oss/hooks/oss-log.sh",
  "launchctl asuser 501 ~/.oss/hooks/oss-log.sh init",
  "launchctl asuser 501 /bin/sh -c '~/.oss/hooks/oss-log.sh init'",
  "launchctl bsexec 1 ~/.oss/hooks/oss-log.sh init",
  "launchctl list rm ~/.oss/hooks/oss-log.sh",
  "launchctl unload rm ~/.oss/hooks/oss-log.sh",
];

/**
 * Ship fix round 9, R9-1 ("Round 9: read every way"): the round-8 re-check regressions (refused at 874deba5,
 * allowed at fab500bb). The command an arch or launchctl part runs is read from every word it could start at,
 * through the gate's full rules: `-c` text, stdin, heredocs, expansions and the wrappers before arch.
 */
const ARCH_EVERY_READING = [
  "arch -arm64 sh -c 'git push origin main'",
  "arch -arm64 sh -c 'git push --force origin feat/x'",
  "launchctl asuser 501 sh -c 'git push origin HEAD:main'",
  "arch -arm64 zsh -c 'git config protocol.ext.allow always'",
  "arch -arm64 bash -c 'g\"\"it push origin main'",
  "arch -arm64 sh -c \"$C\"",
  "C='git push origin main'; arch -arm64 sh -c \"$C\"",
  "arch -arm64 sh -c 'curl x | sh'",
  "arch -arm64 sh -c 'git${IFS}push origin main'",
  "arch -arm64 sh -c 'x=git; $x push origin main'",
  "arch -arm64 /bin/bash -c 'git push -f origin feat/x'",
  "arch -arm64 sh -c 'git -C . push origin main'",
  "arch -arm64 sh -ec 'git push origin main'",
  "arch -arm64 bash -lc 'git push origin main'",
  "launchctl asuser 501 zsh -c 'git config core.hooksPath /tmp/h'",
  "arch -arm64 sh -c 'git checkout main && git commit -m x'",
  "arch -arm64 sh -c 'echo x > .git/con*'",
  "arch -arm64 sh -c 'cp x .g?t/config'",
  "arch -arm64 sh -c 'git push origin HEAD:main'",
  "arch -x86_64 /bin/zsh -c 'git push origin HEAD:main'",
  "arch -arm64 sh -c 'git remote add o http://127.0.0.1/x'",
  "arch -arm64 sh -c 'git remote set-url origin http://127.0.0.1/x'",
  "arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "arch -arm64 bash -lc 'git push origin HEAD:main'",
  "launchctl bsexec 1 zsh -c 'git remote add o http://localhost/x'",
  "arch -arm64 sh -c 'echo; git push origin HEAD:main'",
  "arch -arm64 sh -c \"git push origin HEAD:main\"",
  "arch -arm64 sh -c 'exec git push origin HEAD:main'",
  "arch -arm64 sh -c 'g\"\"it push origin HEAD:main'",
  "arch -arm64 /usr/libexec/git-core/git-push origin HEAD:main",
  "arch -arm64 =git push origin HEAD:main",
  "arch -e BASH_ENV=/tmp/x -arm64 $(echo ~/.oss/hooks/oss-log.sh) init",
  "arch -e BASH_ENV=/tmp/x -arm64 `echo ~/.oss/hooks/oss-log.sh` init",
  "arch -arm64 =git remote add o http://127.0.0.1/x",
  "arch -arm64 =git config protocol.ext.allow always",
  "arch -arm64 sh -c 'cp /tmp/x ~/.cl\"\"aude/settings.json'",
  "arch -arm64 sh -c 'cp /tmp/x .g\"\"it/config'",
  "arch -arm64 sh -c 'cp /tmp/x .gi\\t/config'",
  "arch -arm64 cp /tmp/x ~+/.git/config",
  "arch -arm64 cp /tmp/x $(echo .git/config)",
  "arch -arm64 cp /tmp/x ${P:-.git/config}",
  "arch -arm64 sh -c \"echo x > .git/con'f'ig\"",
  "=arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "exec arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "command arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "nice arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "time arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "nohup arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "\\arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "'arch' -arm64 sh -c 'git config protocol.ext.allow always'",
  "builtin arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "noglob arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "env arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "sudo arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "timeout 5 arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "caffeinate -i arch -arm64 sh -c 'git config protocol.ext.allow always'",
  "=launchctl asuser 501 sh -c 'git config protocol.ext.allow always'",
  "command launchctl asuser 501 sh -c 'git config protocol.ext.allow always'",
  "nohup launchctl asuser 501 sh -c 'git config protocol.ext.allow always'",
  "/bin/launchctl asuser 501 sh -c 'git config protocol.ext.allow always'",
  "arch -arm64 caffeinate -i sh -c 'git push origin HEAD:main'",
  "arch -arm64 timeout 9 sh -c 'git push origin HEAD:main'",
  "arch -arm64 arch -arm64 sh -c 'git push origin HEAD:main'",
  "launchctl asuser 501 /bin/sh -c 'echo x > .g\"\"it/config'",
  "arch -x86_64 /bin/zsh -c \"$CMD\"",
  "CMD='git push origin HEAD:main'; arch -x86_64 /bin/zsh -c \"$CMD\"",
  "arch -arm64 eval 'git push origin HEAD:main'",
  "arch -arm64 sh -s <<< 'git push origin HEAD:main'",
  "echo 'git push origin HEAD:main' | arch -arm64 sh",
  "arch -arm64 sh <<'E'\ngit push origin HEAD:main\nE",
  "arch -arm64 sh <<'E'\ngit config protocol.ext.allow always\nE",
  "arch -arm64 sh <<'E'\ncp /tmp/x .g''it/config\nE",
  "sh -c 'arch -arm64 sh -c \"git push origin HEAD:main\"'",
  "arch -arm64 cp /tmp/x ${P:-~/.claude/settings.json}",
  "arch -arm64 cp /tmp/x ${P:-~/.oss/hooks/oss-log.sh}",
  "arch -e BASH_ENV=/tmp/x -arm64 ${P:-$HOME/.oss/hooks/oss-log.sh} init",
  "arch -e BASH_ENV=/tmp/x -arm64 \"$(printf %s ~/.oss/hooks/oss-log.sh)\" init",
];

/**
 * Ship fix round 9, R9-3: in each reading of an arch or launchctl part, arch's `-e NAME=VALUE` / `-eNAME=VALUE` values and
 * leading `NAME=VALUE` words are environment settings for the command read, so git's env rules see them.
 */
const ARCH_ENV_READINGS = [
  "arch -e GIT_SSH_COMMAND=x -arm64 git fetch origin",
  "arch -arm64e -e GIT_SSH_COMMAND=x git fetch origin",
  "arch -eGIT_SSH_COMMAND=x -arm64 git fetch origin",
  "arch -arm64 GIT_SSH_COMMAND=x git fetch origin",
  "arch -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=protocol.ext.allow -e GIT_CONFIG_VALUE_0=always -arm64 git fetch",
  "launchctl submit -l x -- env GIT_SSH_COMMAND=x git fetch",
  // the same commands without the launcher (controls)
  "GIT_SSH_COMMAND=x git fetch origin",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.ext.allow GIT_CONFIG_VALUE_0=always git fetch",
  "env GIT_SSH_COMMAND=x git fetch",
];

/** R9-1: everyday arch and launchctl calls whose later words read as commands of their own stay allowed. */
const ARCH_READINGS_ALLOWED = [
  "arch -arm64 python3 -m pip install requests",
  "launchctl submit -l x -- /usr/local/bin/node server.js",
  "launchctl print gui/$UID",
  "launchctl print system/com.apple.git",
  "arch -x86_64 /bin/zsh -c 'npm test'",
  // R9-2 ("Yes, first command word only"): git as a later word, or read-only git behind a launchctl subcommand or an `arch -e` value
  "arch -x86_64 brew install git",
  "arch -arm64 brew upgrade git gh",
  "launchctl asuser 501 git status",
  "arch -e FOO=1 -arm64 git log",
  // R9-2 git-writes pick "Accept them": the same verdict as the command without the launcher
  "arch -e FOO=1 git push origin feat/x",
  "launchctl asuser 501 git checkout main",
];

/**
 * Ship fix round 10, R10-1 ("Round 10, blunt"): small fail-closed rules on arch and launchctl parts.
 */
const ARCH_LAUNCHCTL_R10_REFUSED = [
  // (a) launchctl -p, attached or separate, whatever the value
  "launchctl submit -l x -p /bin/sh -- foo -c 'git push origin main'",
  "launchctl submit -p /usr/bin/git -l x -- foo push origin main",
  "launchctl submit -p /usr/bin/git -l x -- foo config protocol.ext.allow always",
  "launchctl submit -p /usr/bin/git -l x -- foo remote add o http://127.0.0.1/x",
  "launchctl submit -p /usr/bin/git -l x -- foo push --force origin feat/x",
  "launchctl submit -p /usr/bin/git -l x -- foo commit -m x",
  "launchctl submit -p /bin/sh -l x -- foo -c 'git push origin main'",
  "launchctl submit -p /usr/bin/git -o /tmp/o -l x -- foo push origin main",
  "launchctl submit -l x -p /usr/bin/git -o /tmp/o -- foo push origin main",
  "launchctl submit -p /usr/bin/git -l x -- foo -C /Users/ysl/dev/oss-plugin-gate-gaps push origin HEAD:main",
  "launchctl submit -p /usr/bin/git -l x -- foo -C /Users/ysl/dev/oss-plugin-gate-gaps config protocol.ext.allow always",
  "launchctl submit -p /usr/bin/git -l x -- foo config --global protocol.ext.allow always",
  "launchctl submit -p /usr/bin/g?t -l x -- foo push origin main",
  "launchctl submit -p /Library/Developer/CommandLineTools/usr/bin/git -l x -- foo push origin main",
  "launchctl submit -l x -p /usr/bin/git -o /dev/null -e /dev/null -- foo push origin main",
  "launchctl submit -l x -p/usr/bin/git -- foo push origin main",
  "launchctl submit -p /bin/sh -l x -- foo",
  // (b) an arch -e / -d value the gate cannot read
  "arch -e \"$V\" git fetch origin",
  "arch -e $V git fetch origin",
  "arch -e \"$V\" -arm64 git fetch origin",
  "arch -arm64 -e \"$V\" git fetch origin",
  "arch -e \"$(cat /tmp/v)\" git fetch origin",
  "arch -e \"$V\" git push origin feat/x",
  "arch -e \"$V\" git commit -m x",
  "arch -e \"$V\" git status",
  "arch -e \"$V\" nice git fetch origin",
  "V=$(printf 'GIT_SSH_COMMAND=touch /tmp/p'); arch -e \"$V\" git fetch origin",
  "V=$(printf 'GIT_SSH_COMMAND=touch /tmp/p'); arch -e \"$V\" git push origin feat/x",
  "V=$(printf 'GIT_SSH_COMMAND=touch /tmp/p'); arch -arm64 -e \"$V\" git fetch origin",
  "read V <<< 'GIT_SSH_COMMAND=touch /tmp/p'; arch -e \"$V\" git fetch origin",
  "arch -e \"$(printf GIT_SSH_COMMAND=x)\" git fetch origin",
  "arch -e \"${V}\" git fetch origin",
  "arch -e \"GIT_SSH_COMMAND=$X\" -arm64 git fetch",
  "arch -e\"$V\" git fetch origin",
  "arch -d \"$V\" git fetch origin",
  // (c) git as an option value of arch or launchctl
  "arch -arch git push origin main",
  "launchctl submit -l git -- push origin main",
  // accepted refusals (owner pick "Accept, card them")
  "arch -arm64 brew install expect",
  "arch -arm64 brew install unzip",
  "arch -arm64 brew install $(cat Brewfile.list)",
  "arch -arm64 pip install $(cat req.txt)",
];

/** R10-1: everyday arch and launchctl calls the round-10 rules leave alone. */
const ARCH_LAUNCHCTL_R10_ALLOWED = [
  "arch -e LANG=C -arm64 make",
  "arch -e FOO=1 -arm64 git log",
  "arch -x86_64 cargo build --bin git",
  "arch -x86_64 grep -e \"$PAT\" README.md",
  "launchctl load -w ~/Library/LaunchAgents/com.oneshotship.daemon.plist",
  "arch -arm64 make \"$TARGET\"",
];

/** R8-1: everyday arch and launchctl calls, and the served login.md daemon blocks, stay allowed. */
const ARCH_LAUNCHCTL_ALLOWED = [
  "arch -x86_64 /bin/zsh -c 'npm test'",
  "arch -x86_64 /bin/zsh -c 'cat README.md'",
  "arch -x86_64 brew install foo",
  "launchctl list",
  "launchctl list | grep oss",
  "launchctl load ~/Library/LaunchAgents/com.x.plist",
  "launchctl unload ~/Library/LaunchAgents/com.x.plist",
  "launchctl kickstart -k gui/501/com.x",
  "launchctl print gui/501/com.x",
  "launchctl bootout gui/501/com.x",
  "launchctl bootstrap gui/501 x.plist",
  "launchctl setenv FOO bar",
  "launchctl getenv PATH",
  "launchctl list && ~/.oss/hooks/oss-log.sh init",
  "PLIST_PATH=\"${HOME}/Library/LaunchAgents/com.oneshotship.daemon.plist\"\nif ! launchctl list | grep -q \"com.oneshotship.daemon\"; then\n    launchctl load \"$PLIST_PATH\"\n    echo \"OSS Daemon started\"\nfi",
  "PLIST_PATH=\"${HOME}/Library/LaunchAgents/com.oneshotship.daemon.plist\"\nif launchctl list | grep -q \"com.oneshotship.daemon\"; then\n    echo \"Supervisor daemon is running\"\nelse\n    echo \"Note: Daemon didn't start. You can start it manually with: launchctl load $PLIST_PATH\"\nfi",
];

/** Already refused by the path-mention rule (`set` names a hook path): kept as guards. */
const REFUSED_ANY = ['set -- env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh; "$@"'];

const ALLOWED = [
  'c=ls; $c -la',
  'cmd=npm; $cmd test',
  '${EDITOR:-vi} notes.txt',
  'a[0]=ls; ${a[0]} -la',
  // R2-4: a default stays a readable value
  '"${CC:-cc}" -o x x.c',
  '${PAGER:-less} README.md',
  // a plain `${name}` is no operator: the plugin's own hook call stays allowed
  '"${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh" init',
  '${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh init',
  // R3-4 (owner pick "Allow it again"): the served plugin-root forms with a default or a trailing-slash trim
  '"${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/check-updates.sh"',
  '${CLAUDE_PLUGIN_ROOT%/}/hooks/check-updates.sh',
  '"${CLAUDE_PLUGIN_ROOT%/}/hooks/check-updates.sh"',
  '${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/check-updates.sh',
  // R5-1 F3: the braced `${HOME}` served form stays allowed
  '"${CLAUDE_PLUGIN_ROOT:-${HOME}/.claude/plugins/oss}/hooks/check-updates.sh"',
  // R5-2: the test builtins `[` / `[[` are not `env`, as served login and settings blocks run them on a hook line
  'PLUGIN_ROOT=$(~/.oss/hooks/oss-value.sh root) || exit 1\nif [ ! -d "dist" ]; then\n    npm run build\nfi',
  'V=~/.oss/hooks/oss-value.sh\nSTYLE=$("$V" read notify_style) || exit 1\nif [[ "$STYLE" == "audio" ]]; then echo x; fi',
  // R6-3: `arch` with no `-e` sets nothing
  'arch -arm64 npm test',
  'arch',
  // R6-2: programs whose name only contains env are not env
  'envsubst < a.tmpl > a.txt; ~/.oss/hooks/oss-log.sh init',
  'printenv; ~/.oss/hooks/oss-log.sh init',
  './env.sh; ~/.oss/hooks/oss-log.sh init',
  'myenv; ~/.oss/hooks/oss-log.sh init',
  // R7-2: arch with no `-e`, env-named tools, test builtins and a substitution that is not the program word stay allowed
  'arch -x86_64 make',
  'arch -arm64 npm test; ~/.oss/hooks/oss-log.sh init',
  'arch -arm64 npm test',
  'arch -e LANG=C -arm64 make',
  "arch -x86_64 /bin/zsh -c 'npm test'",
  'cross-env NODE_ENV=test npm test; ~/.oss/hooks/oss-log.sh init',
  'dotenv -- npm test; ~/.oss/hooks/oss-log.sh init',
  'pyenv local 3.12; ~/.oss/hooks/oss-log.sh init',
  '[ -f x ] && ~/.oss/hooks/oss-log.sh init',
  '[[ -f x ]] && ~/.oss/hooks/oss-log.sh init',
  'test -f x && ~/.oss/hooks/oss-log.sh init',
  'cd "$(git rev-parse --show-toplevel)" && ~/.oss/hooks/oss-log.sh init',
  '[ -z "$(~/.oss/hooks/oss-value.sh root)" ] && echo none',
];

/** Lines another rule may refuse; the hook-call rule must not. */
const NOT_HOOK = ['NODE_ENV=test node "$SCRIPT"'];

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('refuses a hook call whose program is a value split with the words after it: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/OSS hook script/);
    });

    it.each(OTHER_OPERATORS)('refuses a hook line whose program word uses an expansion operator the gate does not read: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ENV_BY_PATH)('refuses a hook line run through env by its path, a glob or a variable value: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_SETS)('refuses a hook line run through arch with a variable set by -e: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(HOOK_ENV_BLUNT)('refuses a hook line where env or arch may run by a glob, a substitution, a split piece or a wrapper: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_LAUNCHCTL_BLUNT)('refuses arch or launchctl running a hook, env or a protected write: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_EVERY_READING)('refuses what arch or launchctl runs, read from every start: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_ENV_READINGS)('refuses git with an environment set through arch -e or a leading assignment: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_READINGS_ALLOWED)('allows everyday arch and launchctl calls read from every start: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });

    it.each(ARCH_LAUNCHCTL_R10_REFUSED)('refuses launchctl -p, an unreadable arch -e/-d value or git as an option value: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ARCH_LAUNCHCTL_R10_ALLOWED)('allows everyday arch and launchctl calls the round-10 rules leave alone: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });

    it('reads a program word of 40 stars quickly (R10-1 (d))', async () => {
      const command = `/usr/bin/${'*'.repeat(40)}x -arm64 make`;
      const started = Date.now();
      await call(command, agent, platform);
      expect(Date.now() - started).toBeLessThan(4000);
    });

    it.each(ARCH_LAUNCHCTL_ALLOWED)('allows everyday arch and launchctl calls: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });

    it.each(REFUSED_ANY)('refuses a hook call run through the positional parameters: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ALLOWED)('allows a program kept in a variable with a plain value: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });

    it.each(NOT_HOOK)('leaves a plain program with a variable operand to the other rules: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    });
  });
});
