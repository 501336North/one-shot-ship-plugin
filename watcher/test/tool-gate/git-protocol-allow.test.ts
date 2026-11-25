/**
 * @behavior The main agent and builders can't let git use a protocol that runs a command or reads this machine
 *   (`ext::`, `file://`): `GIT_ALLOW_PROTOCOL` set for a call, alone, through `env` or exported, and any
 *   `protocol.<name>.allow` key set through `git config`, `-c` or `GIT_CONFIG_KEY_n`, are refused. Everyday fetches,
 *   `-c protocol.version=2`, reading a protocol key, and `-c protocol.file.allow` on `git submodule` stay allowed. The find-glob matcher keeps working on a glob
 *   with a very large set of positions (a plain loop finds the lowest, not an argument spread).
 * @business-rule gate-gaps-r3 ship round 1, S4 (owner pick "Fix 1 and 2, card 3"; follow-up pick "Allow on submodule only").
 * @boundary runToolGate (the gate as the hook calls it) with a scratch repo whose origin is a real host, on darwin
 *   and linux; the glob matcher directly, since the gate refuses a word that long before it reaches the matcher.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { couldMatch, globTokens } from '../../src/tool-gate/rules/verdict-capture-call.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-git-protocol-allow-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/x.git'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'git-protocol-allow',
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
  "GIT_ALLOW_PROTOCOL=ext git ls-remote 'ext::sh -c true'",
  'export GIT_ALLOW_PROTOCOL=ext',
  "export GIT_ALLOW_PROTOCOL=ext:https; git fetch 'ext::sh -c true'",
  "GIT_ALLOW_PROTOCOL=ext; git ls-remote 'ext::sh -c true'",
  "env GIT_ALLOW_PROTOCOL=ext git ls-remote 'ext::sh -c true'",
  'git config protocol.file.allow always',
  'git config --global protocol.ssh.allow always',
  'git -c protocol.file.allow=always fetch origin',
  'git -c protocol.file.allow=always fetch /tmp/x',
  'git -c protocol.file.allow=always clone /tmp/x y',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always git fetch origin',
];

/** Ship fix round 2, R2-2 ("Blunt: refuse any mention"): any command whose text names GIT_ALLOW_PROTOCOL. */
const NAMES_ALLOW_PROTOCOL = [
  'set -a; printf -v GIT_ALLOW_PROTOCOL ext; git submodule update --init',
  'set -a; read GIT_ALLOW_PROTOCOL <<< ext; git submodule update --init',
  'private -x GIT_ALLOW_PROTOCOL=ext; git submodule update --init',
  'set -a; : ${GIT_ALLOW_PROTOCOL:=ext}; git submodule update --init',
  'printf -v GIT_ALLOW_PROTOCOL ext; export GIT_ALLOW_PROTOCOL; git fetch origin',
  "env -S 'GIT_ALLOW_PROTOCOL=ext git fetch origin'",
];

/** Ship fix round 3, R3-1: the name split by quotes or built from an expansion, which the text check can't see. */
const SPLIT_ALLOW_PROTOCOL = [
  'export GIT_ALLOW_PROT""OCOL=ext; git fetch origin',
  "env GIT_ALLOW_PROT''OCOL=ext git fetch origin",
  'export GIT_ALLOW_PROT\\OCOL=ext; git fetch origin',
  "export $'GIT_ALLOW_PROTO\\x43OL=ext'; git fetch origin",
  'x=PROTOCOL; typeset -x "GIT_ALLOW_${x}"=ext; git fetch origin',
  "export GIT_ALLOW_PROT''OCOL=ext; git clone 'ext::sh -c touch% /tmp/pwn' x",
  'x=PROTOCOL; export GIT_ALLOW_$x=ext; git fetch origin',
  'printf -v "GIT_ALLOW_PROT""OCOL" ext; export GIT_ALLOW_PROT""OCOL; git fetch origin',
  'declare -x GIT_ALLOW_PROT""OCOL=ext; git fetch origin',
  "export 'GIT_ALLOW_PROTO'COL=ext; git fetch",
  "x=1 GIT_ALLOW_PROTO''COL=ext git fetch",
];

/** Ship fix round 4, R4-3 ("Both layers"), (1): the name check, quotes and escapes removed, and unreadable setter names. */
const NAME_LAYER = [
  'x=GIT_ALLOW_PROTOCO; export ${x}L=ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; env ${x}L=ext git fetch origin',
  'x=GIT_ALLOW_PROTOCO; env ${x}L=ext git submodule update --init',
  'env "$(echo GIT_ALLOW_PROTOC)OL=ext" git fetch origin',
  'export "$(printf GIT_ALLOW_PROTOC)OL=ext"; git fetch origin',
  'x=git_allow_protocol; export ${x:u}=ext; git fetch origin',
  'x=git_allow_protocol; export ${x^^}=ext; git submodule update --init',
  'x=PROT; export GIT_ALLOW_${x}OCOL=ext; git fetch origin',
  "eval GIT_ALLOW_PROT''OCOL=ext git fetch origin",
  "eval 'export GIT_ALLOW_PROT''OCOL=ext'; git fetch origin",
  'sh -c "GIT_ALLOW_PROT\'\'OCOL=ext git fetch origin"',
  "bash -c 'GIT_ALLOW_PROT\"OCOL\"=ext git fetch origin'",
  'env -S "GIT_ALLOW_PROT\'\'OCOL=ext git fetch origin"',
  'env --split-string="GIT_ALLOW_PROT\'\'OCOL=ext git fetch origin"',
  "IFS== read -r n v <<< GIT_ALLOW_PROT''OCOL=ext; export \"$n=$v\"; git fetch origin",
  "declare -n r=GIT_ALLOW_PROT''OCOL; r=ext; export r; git fetch origin",
  'x=y; declare -n r=$x; r=ext; export r; git fetch origin',
  "export GIT_ALLOW_PROT''OCOL+=ext; git submodule update --init",
  "readonly -x GIT_ALLOW_PROT''OCOL=ext; git fetch origin",
  "local -x GIT_ALLOW_PROT''OCOL=ext; git fetch origin",
  "typeset -gx GIT_ALLOW_PROT''OCOL=ext; git fetch origin",
  "nohup env GIT_ALLOW_PROT''OCOL=ext git fetch origin",
  "command env GIT_ALLOW_PROT''OCOL=ext git fetch origin",
  "builtin export GIT_ALLOW_PROT''OCOL=ext; git fetch origin",
  "xargs -0 printf < /dev/null; set -a; GIT_ALLOW_PROT''OCOL=ext; git fetch origin",
  "GIT_ALLOW_PROT''OCOL=ext; export GIT_ALLOW_PROT''OCOL; git fetch origin",
  'x=GIT_ALLOW_PROTOCO; set -a; read ${x}L <<< ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; printf -v ${x}L ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; mapfile ${x}L < /dev/null; git fetch origin',
  // R5-1 F2: an unreadable NAME after value-taking options stays refused (`-a` takes a name)
  'x=GIT_ALLOW_PROTOCO; read -a ${x}L <<< ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; read -p "? " ${x}L; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; mapfile -t -u 3 ${x}L; git fetch origin',
  // ship fix round 6, R6-1 ("Fail closed"): a word after a read/mapfile option may be the name (zsh: `-t`, `-n`,
  // `-p` take no value), so it counts as one unless it is a plain number
  'x=GIT_ALLOW_PROTOCO; set -a; read -t ${x}L <<< ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; read -n ${x}L <<< ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; read -rt ${x}L <<< ext; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; read -p ${x}L; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; coproc echo ext; read -p ${x}L; git fetch origin',
  'x=GIT_ALLOW_PROTOCO; set -a; read -t ${x}L <<< ext; u=ex; git clone "${u}t::sh -c id" y',
  "x=GIT_ALLOW_PROTOCO; set -a; read -t ${x}L <<< ext; git -c url.ext:.insteadOf=foo: clone 'foo::sh -c id' y",
  // R6-1 owner-accepted flip (was allowed under R5-1 F2): an expansion in the option value may be the name in zsh
  'read -p "Push $branch? " ans; git push origin feat/x',
  'read -n 1 -s -r -p "Delete $f? " a; git status',
  'read -t "$T" ans; git status',
  'read -u "$fd" line; git status',
  'mapfile -t -u "$fd" lines; git status',
  // ship fix round 7, R7-3 ("Blunt on git lines"): zsh `print -v`, a `read` name's `?prompt`, and `${!…}` / `${(P)…}` assignments
  'x=PROTOCO; setopt allexport; read "GIT_ALLOW_${x}L?p" <<< ext; git ls-remote origin',
  'x=PROTOCO; set -a; read "GIT_ALLOW_${x}L?p" <<< ext; git fetch origin',
  'x=PROTOCO; setopt allexport; print -v GIT_ALLOW_${x}L ext; git ls-remote origin',
  'x=PROTOCO; setopt allexport; print -rv GIT_ALLOW_${x}L ext; git ls-remote origin',
  'x=PROTOCO; n=GIT_ALLOW_${x}L; set -a; : ${!n:=ext}; git ls-remote origin',
  'x=PROTOCO; n=GIT_ALLOW_${x}L; setopt allexport; : ${(P)n::=ext}; git ls-remote origin',
  'x=PROTOCO; n=GIT_ALLOW_${x}L; set -a; : ${(P)n=ext}; git fetch origin',
];

/** R4-3 (2): an `ext::` or `fd::` transport anywhere on a git line, quotes and escapes removed. */
const TRANSPORT_LAYER = [
  "git clone 'ext::sh -c touch% /tmp/pwn' x",
  "git remote add e 'ext::sh -c touch% /tmp/pwn'; git fetch e",
  "x=GIT_ALLOW_PROTOCO; env ${x}L=ext git clone 'ext::sh -c touch% /tmp/pwn' x",
  'env -S "GIT_ALLOW_PROT\'\'OCOL=ext git clone \'ext::sh -c touch% /tmp/pwn\' x"',
  "git fetch 'ext::sh -c touch% /tmp/pwn'",
  "git ls-remote 'ext::sh -c id'",
  "git remote set-url origin 'ext::sh -c id'",
  "git -c 'url.ext::sh -c id #.insteadOf=https://github.com/' fetch origin",
  "git submodule add 'ext::sh -c id' sub",
  "git clone e''xt::sh x",
  'git clone e\\xt::sh x',
  'git clone fd::3 x',
  "git clone 'EXT::sh -c id' x",
  // ship fix round 5, R5-1 F1: a bare `ext::` / `fd::` mention stays refused
  'git commit -m "fix ext:: handling"',
  "git log -S 'ext::'",
];

const ALLOWED = [
  // R4-3: everyday git lines with variables stay allowed
  'x=1; export EXTRA=$x; git fetch origin',
  'read -r line < /dev/null; git status',
  'git commit -m "ext: handle the case"',
  'git clone https://github.com/a/b.git x',
  // ship fix round 5, R5-1 F1: text after `::` is a path, not a transport (Rust `std::os::fd::`, `crate::ext::`)
  'git commit -m "use std::os::fd::OwnedFd for the pipe"',
  "git grep -n 'os::fd::'",
  "git grep -n 'context::ext::'",
  'git commit -m "wrap crate::ext::str"',
  "rg 'std::os::fd::' src && git status",
  "git commit -F - <<'EOF'\nuse std::os::fd::OwnedFd\nEOF",
  "which git; rg 'os::fd::' src",
  // R5-1 F2: an option's value is not a name being set
  'read -a parts <<< "$x"; git status',
  // ship fix round 6, R6-1: a plain-number option value, an attached value, or a value with no expansion stays allowed
  'read -t 5 ans; git status',
  'read -u 3 line; git status',
  'read -n 1 -s -r a; git status',
  'read -t5 ans; git status',
  'read -u3 line; git status',
  "read -rp '? ' ans; git status",
  'read -ra arr <<< "a b"; git status',
  "read -rd '' x < /dev/null; git status",
  // R7-3: `print` without `-v`, a plain prompt name, `printf -v` with a plain name, and a plain `${FOO:=bar}` stay allowed
  'print -r -- "$x"; git status',
  "read 'ans?Continue? '; git status",
  "printf -v msg '%s' x; git status",
  ': ${FOO:=bar}; git status',
  'echo protocol',
  'git fetch origin',
  'git ls-remote origin',
  'git -c protocol.version=2 fetch origin',
  'git config --get protocol.file.allow',
  // S4 follow-up pick "Allow on submodule only": a local-path submodule needs the file protocol
  'git -c protocol.file.allow=always submodule add ../lib lib',
  'git -c protocol.file.allow=always submodule update',
];

describe.each(PLATFORMS)('git protocols that run commands (ship round 1, S4) on %s', (platform) => {
  describe.each(AGENTS)('%s', (_label, agent) => {
    it.each(REFUSED)('refuses allowing a protocol by variable or config key: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(NAMES_ALLOW_PROTOCOL)('refuses any command that names GIT_ALLOW_PROTOCOL: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(SPLIT_ALLOW_PROTOCOL)('refuses GIT_ALLOW_PROTOCOL set under a split or built name: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(NAME_LAYER)('refuses GIT_ALLOW_PROTOCOL set under any spelling, or a setter name it cannot read, on a git line: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(TRANSPORT_LAYER)('refuses an ext:: or fd:: transport on a git line: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ALLOWED)('allows everyday fetches and reading protocol settings: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});

describe('the find-glob matcher on a glob with a very large set of positions (ship round 1, S4)', () => {
  it('decides without throwing, where spreading the positions as arguments throws', () => {
    const tokens = globTokens('*'.repeat(500_000));
    expect(couldMatch(tokens, ['workflow-state', '.json'], false)).toBe(true);
  });
});
