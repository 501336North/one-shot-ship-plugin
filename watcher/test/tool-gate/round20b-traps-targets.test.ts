/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere): an ordinary clean-up trap set
 *   before its variable is allowed when the variable is later set to a new temp path (`$(mktemp -d /tmp/x.XXXXXX)`,
 *   `` `mktemp -d` ``), a status it sets in its own script (`rc=$?`) or a pid it waits for (`wait $pid`); it is
 *   refused when the temp path could be protected (`$(mktemp .oss/x.XXXX)`), when bash could split the variable at
 *   a changed IFS (`IFS=/; … F=x/.oss`), or when a set hides behind `time { … }`. A copy whose target folder sits
 *   inside an option cluster (`cp -at.oss`, `cp --targ .oss`, `tar -xC../.oss`, `unzip -qd../.oss`) has that folder
 *   checked, and a Homebrew GNU-named writer (`gditto`, `gtee`, `grm` …) is judged as the program it is.
 * @business-rule R-266 round 20 Part B: CR MEDIUM-1 (IFS), CR MEDIUM-2 + PERF LOW-1 (trap-first forms), CR LOW-1
 *   (`-t` inside a cluster), SEC INFO-1 / SEC limit 2 / CR I-1 (one list of GNU names), CR I-2 (`time { … }`).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, on darwin (zsh) and linux (bash).
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r20b-traps-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
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
        session_id: 'r20b-traps',
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

async function allowed(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refuse(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

const HOME_D = 'D=$(cd ~ && pwd); ';

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each([
      "IFS=/; trap 'rm -rf $F' EXIT; F=x/.oss",
      "IFS=/; trap 'rm -rf $F' EXIT; F=x/.claude",
      "trap 'rm -rf $F' EXIT; IFS=/; F=x/.oss",
    ])('CR MEDIUM-1: refuses a trap reading a later-set variable unquoted when the command changes IFS: %s', (command) =>
      refuse(command, agent, platform));

    it.each([
      "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; while IFS= read -r l; do echo \"$l\"; done < README.md",
      'IFS=, read -r a b <<< "1,2"; echo $a',
      "trap 'rm -rf \"$F\"' EXIT; IFS=/; F=x/.oss",
    ])('CR MEDIUM-1: keeps allowing IFS forms that split nothing the trap reads: %s', (command) =>
      allowed(command, agent, platform));

    it.each([
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d /tmp/x.XXXXXX); npm test",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -dt x); npm test",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d -q); npm test",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -t x -d); npm test",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=`mktemp -d`; npm test",
      "trap 'rm -f \"$f\"' EXIT; f=$(mktemp /tmp/x.XXXX); date > \"$f\"",
      "trap 'rm -f \"$f\"' EXIT; f=$(mktemp \"$TMPDIR/x.XXXX\"); date > \"$f\"",
      "trap 'rc=$?; rm -rf \"$tmp\"; exit $rc' EXIT; tmp=$(mktemp -d); npm test",
      "tmp=$(mktemp -d); trap 'rc=$?; rm -rf \"$tmp\"; exit $rc' EXIT; npm test",
      "trap 'kill $pid; wait $pid' EXIT; npm run dev & pid=$!; sleep 1",
      "trap 'wait $pid' EXIT; npm run dev & pid=$!",
      "trap 'echo \"rc=$rc\"' EXIT; npm test; rc=$?",
    ])('CR MEDIUM-2: allows an ordinary trap-first clean-up: %s', (command) => allowed(command, agent, platform));

    it.each([
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp .oss/tool-gates.XXXX)",
      "trap 'rm -rf $tmp' EXIT; tmp=$(mktemp .oss/tool-gates.XXXX)",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -p ~/.claude)",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d -p .oss/tool-gates)",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=`mktemp -d ~/.claude/settings.XXXX`",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d .git/hooks/x.XXXX)",
      "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d \"$X/x.XXXX\")",
      "TMPDIR=.oss/tool-gates; trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d)",
      "trap 'F=.oss; rm -rf \"$F\"' EXIT",
      "trap 'F=.oss; rm -rf \"$F\"' EXIT; F=src",
      "trap 'wait -p F $pid; rm -rf \"$F\"' EXIT; F=src",
      "trap 'wait $W; rm -rf \"$F\"' EXIT; F=src; W=-pF",
      "trap 'wait -p $W; rm -rf \"$F\"' EXIT; F=src; W=F",
      "trap 'rm -rf $F' EXIT; time { read F; }",
      "trap 'rm -rf $F' EXIT; time { F=$(cat name.txt); }",
      "trap 'rm -rf $F' EXIT; time -p { read F; }",
    ])('CR MEDIUM-2: refuses a trap whose variable could still name a protected path: %s', (command) =>
      refuse(command, agent, platform));

    it('CR I-2: names the real word, not `{`, when `time { F=.oss; }` is refused', async () => {
      const result = await call("trap 'rm -rf $F' EXIT; time { F=$(cat name.txt); }", agent, platform);
      expect(result.stderr).not.toContain('`{`');
      const plain = await call('time { cd .oss; }', agent, platform);
      expect(plain.stderr).not.toContain('`{`');
    });
  });
});

describe.each(AGENTS)('%s', (_who, agent) => {
  const platform: NodeJS.Platform = 'linux';

  it.each([
    'cp -at.oss x',
    'mv -ft.oss x',
    'ln -st.oss /tmp/x',
    'gcp -at.claude x',
    `${HOME_D}cp -at"$D"/.claude x`,
    'cp --targ .oss x',
    'cp --target=.oss x',
    'cp --targ=.oss x',
    'cp -at .oss x',
    `${HOME_D}cp --targ "$D"/.claude x`,
    `${HOME_D}mv -ft"$D"/.claude x`,
    `${HOME_D}ginstall -Dt"$D"/.claude x`,
    'cd src && tar -xC../.oss -f t.tar',
    'cd src && unzip -qd../.oss t.zip',
    `cd src && ${HOME_D}tar -xC"$D"/.claude -f t.tar`,
    `cd src && ${HOME_D}unzip -qd"$D"/.claude t.zip`,
  ])('CR LOW-1: refuses a target folder written inside an option cluster or as a long-option prefix: %s', (command) =>
    refuse(command, agent, platform));

  it.each([
    'cp -a src dist',
    'cp -t dist x',
    'mv -t build a b',
    'cp --target-directory=dist x',
    'cp -at dist x',
    'cp --targ dist x',
    'cp -av src/. dist/',
    'tar -xf t.tar -Cbuild',
    'unzip -o x.zip -dout',
    'cd src && tar -xCout -f t.tar',
    'cd src && unzip -qdout t.zip',
  ])('CR LOW-1: keeps allowing an ordinary target folder: %s', (command) => allowed(command, agent, platform));

  it.each([
    `${HOME_D}gditto x "$D"/.claude`,
    'gtee .oss/tool-gates.json < x',
    'grm -rf .oss',
    'gdd if=x of=.oss/tool-gates.json',
    'gtouch .claude/settings.json',
    'gshred -u .oss/tool-gates.json',
    'gmkdir .git/hooks/x',
    'gsed -i s/a/b/ .oss/tool-gates.json',
    `${HOME_D}grm -rf "$D"/.claude/x`,
    `${HOME_D}gchmod -R 777 "$D"/.claude/x`,
    'cd src && gtruncate -s0 ../.oss/tool-gates.json',
  ])('SEC INFO-1: refuses a GNU-named writer aimed at a protected place: %s', (command) => refuse(command, agent, platform));

  it.each([
    ['gtee', 'tee'],
    ['gtouch', 'touch'],
    ['gdd of=', 'dd of='],
    ['gshred -u', 'shred -u'],
    ['gmkdir', 'mkdir'],
    ['gsed -i s/a/b/', 'sed -i s/a/b/'],
    ['grm -rf', 'rm -rf'],
    ['gditto x', 'ditto x'],
  ])('SEC INFO-1: judges %s through an unknown home folder as it judges %s', async (gnu, plain) => {
    const target = gnu.endsWith('=') ? '"$D"/.claude/x' : ' "$D"/.claude/x';
    const asGnu = await call(`${HOME_D}${gnu}${target}`, agent, platform);
    const asPlain = await call(`${HOME_D}${plain}${target}`, agent, platform);
    expect(asGnu.exitCode, gnu).toBe(asPlain.exitCode);
  });

  it.each([
    "gsed -i 's/a/b/' x.txt",
    'gtee out.txt < in.txt',
    'grm -f build/x',
    'grep -r foo .',
    'gzip -k x.log',
    'git status',
    'gmkdir -p build/y',
    'gtouch build/z',
  ])('SEC INFO-1: keeps allowing an ordinary GNU-named or g-starting program: %s', (command) =>
    allowed(command, agent, platform));
});
