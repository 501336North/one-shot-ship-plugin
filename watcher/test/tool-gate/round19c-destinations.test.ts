/**
 * @behavior The main agent's and builders' Bash calls can't unpack into a folder that holds protected files
 *   by attaching it to the folder option (`tar -C"$D"/.oss`, `unzip -d"$D"/.claude`,
 *   `--directory="$D"/.claude`), nor copy, move or link into one with the GNU `g` names (`gcp`, `gmv`, `gln`,
 *   `ginstall`, `grsync`). Ordinary
 *   unpacks and copies into a plain or variable folder stay allowed (`tar -xf t.tar -Cbuild`,
 *   `unzip -o x.zip -d"$OUT"`, `gcp -R src dist`).
 * @business-rule R-266 round 19: SEC MEDIUM-2 (attached folder options; g-variants in the destination check).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import { loadSettings } from '../../src/tool-gate/rule-file.js';
import { checkProtectedPathBash } from '../../src/tool-gate/rules/protected-path.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r19c-forms-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r19c-destinations',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

describe.each(AGENTS)('round 19 destinations, %s', (_who, agent) => {
  it.each([
    'D=$(cd ~ && pwd); tar -xf t.tar -C"$D"/.oss',
    'D=$(cd ~ && pwd); unzip -o x.zip -d"$D"/.claude',
    'tar -xf t.tar --directory="$D"/.claude',
    'gtar -xf t.tar -C"$D"/.oss',
    'bsdtar -xf t.tar -C"$D"/.claude',
  ])('SEC MEDIUM-2: refuses unpacking into a folder attached to its option that could hold protected files: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  // these need Part B's g-variant write targets (command-reader.ts) as well
  it.each([
    'D=$(cd ~ && pwd); gcp -R mydir/. "$D"/.claude',
    'D=$(cd ~ && pwd); gmv x "$D"/.claude',
    'D=$(cd ~ && pwd); gln -sfn /tmp/z "$D"/.claude',
    'D=$(cd ~ && pwd); ginstall x "$D"/.claude',
    'D=$(cd ~ && pwd); gcp -t "$D"/.claude x',
    'D=$(cd ~ && pwd); grsync -a x/ "$D"/.claude/',
    'gcp x .oss/tool-gates.json',
  ])('PEN MEDIUM: refuses a GNU g-named copy, move or link into a folder that could hold protected files: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it.each([
    'tar -xf t.tar -Cbuild',
    'tar -xf t.tar -C"$OUT"',
    'unzip -o x.zip -dout',
    'unzip -o x.zip -d"$OUT"',
    'tar -C "$OUT" -xf t.tar',
    'tar -xf t.tar -C "$OUT"',
    'gcp -R src dist',
    'gmv a b',
    'gln -s "$PWD/dist" current',
    'ginstall -m 644 x "$OUT/"',
    'grsync -a src/ "$DEST/"',
    'gtar -xf t.tar -C "$OUT"',
  ])('keeps an ordinary unpack or copy into a plain or variable folder allowed: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).toBe('');
    expect(result.exitCode, command).toBe(0);
  });
});

describe('round 19 destination check for GNU g-named programs', () => {
  const ROOT = '/work/repo';
  const HOME = '/home/dev';
  const settings = loadSettings((p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null), PLUGIN_ROOT, ROOT).settings;

  it.each([
    ['grsync', 'rsync -a x/ "$D"/.claude/'],
    ['gditto', 'ditto mydir "$D"/.claude'],
    ['gcp', 'cp -R mydir/. "$D"/.claude'],
    ['gmv', 'mv x "$D"/.claude'],
    ['gln', 'ln -sfn /tmp/z "$D"/.claude'],
    ['ginstall', 'install -d "$D"/.claude'],
  ])('PEN MEDIUM: judges %s writing into a folder that could hold protected files as its base program', (g, command) => {
    const facts = readCommand(command, ROOT, HOME);
    if ('unreadable' in facts) throw new Error(`expected a readable command: ${facts.reason}`);
    const [part] = facts.parts;
    const refusal = checkProtectedPathBash({ ...part, name: g, program: g, words: [g, ...part.words.slice(1)] }, settings, ROOT, HOME, { realpath: (p) => p });
    expect(refusal?.reason).toMatch(/^Refused/);
  });
});
