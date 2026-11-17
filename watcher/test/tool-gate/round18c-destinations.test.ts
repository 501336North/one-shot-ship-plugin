/**
 * @behavior The main agent's and builders' Bash calls can't copy, move, link or unpack into a folder that
 *   holds protected files (`~/.claude`, `.oss`) by naming it after a folder only known when the command runs
 *   (`"$D"/.claude` with `D=$(cd ~ && pwd)`), nor move such a folder away (`mv "$X"/.oss /tmp/y`).
 *   Ordinary copies, moves and unpacks into a folder named by a variable stay allowed (`cp -R "$SRC" "$OUT"`,
 *   `cp -R "$SRC" "$OUT/assets"`, `mv "$X"/build dist`, `tar -xf t.tar -C "$OUT"`).
 * @business-rule R-266 round 18, SEC MEDIUM-3: a destination (or a moved source) with an unknown start and a
 *   literal end that names a folder holding protected files is refused, for cp, mv, ln, install, ditto, rsync,
 *   `tar -C`/`--directory` and `unzip -d`.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo.
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

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r18c-forms-')));
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
        session_id: 'r18c-destinations',
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

describe.each(AGENTS)('round 18 destinations, %s', (_who, agent) => {
  it.each([
    'D=$(cd ~ && pwd); cp -R mydir/. "$D"/.claude',
    'D=$(cd ~ && pwd); mv "$D"/.claude "$D"/.claude.bak',
    'D=$(cd ~ && pwd); rsync -a mydir/ "$D"/.claude/',
    'D=$(cd ~ && pwd); tar -xf t.tar -C "$D"/.claude',
    'D=$(cd ~ && pwd); tar -xf t.tar --directory="$D"/.claude',
    'D=$(cd ~ && pwd); unzip -o x.zip -d "$D"/.oss',
    'D=$(cd ~ && pwd); ln -sfn /tmp/z "$D"/.claude',
    'D=$(cd ~ && pwd); install -d "$D"/.claude',
    'D=$(cd ~ && pwd); ditto mydir "$D"/.claude',
    'mv "$X"/.oss /tmp/y',
    'cp -R x "$D"/.git/hooks',
  ])('SEC MEDIUM-3: refuses writing into, or moving, a folder after an unknown start that could hold protected files: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it.each([
    'cp -R src dist',
    'cp -R "$SRC" "$OUT"',
    'cp -R "$SRC" "$OUT/assets"',
    'cp a.txt "$OUT"/notes.txt',
    'mv "$TMP/out" build/',
    'mv "$X"/build dist',
    'mv "$X"/src "$Y"/src',
    'rsync -a src/ "$DEST/"',
    'tar -xf t.tar -C "$OUT"',
    'tar -xf t.tar --directory="$OUT"/x',
    'unzip -o x.zip -d "$OUT"',
    'ln -sfn "$PWD/dist" current',
    'install -m 644 a "$D"/bin/a',
    'ditto src "$D"/build',
    // D-R18-2: only the literal end is checked for a destination
    'cp x ../"$NAME"',
    'cp x ~/"$D"/y',
  ])('keeps an ordinary copy, move or unpack into a variable folder allowed: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).toBe('');
    expect(result.exitCode, command).toBe(0);
  });
});
