/**
 * @behavior When part of a Bash call can't be read, the gate still checks every part it can
 *   read. A call that reaches a reading limit (nesting, size, braces, word or character budget)
 *   is refused as too complex to check. A call with an unreadable piece is refused when it also
 *   runs git that writes refs or config, names a protected path, or runs an interpreter or shell;
 *   otherwise it is allowed and logged `unreadable`. A refusal never shows the gate's internal
 *   placeholder for unknown text.
 * @business-rule ADR-010 (user decision, supersedes ADR-009's "unreadable = allow"): unreadable
 *   is refused only when risky; slowness and unreadable text must not be a way around the rules.
 * @boundary runToolGate in-process, real temp git repo, real file system.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import type { GateSettings } from '../../src/tool-gate/rule-file.js';
import { checkUnreadable } from '../../src/tool-gate/rules/unreadable.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo with one empty commit, on `main` or on a feature branch. */
function makeRepo(branch: 'main' | 'feat/x'): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-unreadable-')));
  tempDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  if (branch !== 'main') git(repo, ['checkout', '-q', '-b', branch]);
  return repo;
}

function events(repo: string): Record<string, unknown>[] {
  const file = path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function bash(repo: string, command: string): Promise<GateResult> {
  const input = JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  return runToolGate({ mode: 'pre', input, env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
}

describe('tool-gate: commands it cannot fully read (ADR-010)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should refuse a push to main followed by braces past the reading limit, as too complex to check', async () => {
    const repo = makeRepo('main');

    const result = await bash(repo, `git push origin main ${'{1,2}'.repeat(9)}`);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('too complex for the gate to check');
    expect(result.stderr).toContain('split it into simpler commands');
  });

  it.each([
    ['a push to main after a ${…} that runs a command', 'echo ${x:-$(true)}; git push origin main'],
    ['a protected file removed after a ${…} that runs a command', 'true ${x:-$(true)} && rm -rf .oss/tool-gates.json'],
    ['a shell whose script expands a variable before a force push', "bash -c 'echo $0; git push --force'"],
    ['eval of a script that expands a variable and removes the gate state', "eval 'echo $x; rm -rf .oss/tool-gates'"],
  ])('should refuse %s', async (_what, command) => {
    const repo = makeRepo('feat/x');

    const result = await bash(repo, command);

    expect(result.exitCode).toBe(2);
    expect(events(repo)).toContainEqual(expect.objectContaining({ kind: 'refusal', result: 'refused' }));
  });

  it('should refuse a command with an unreadable piece that names a protected path, even with a read-only program', async () => {
    const repo = makeRepo('feat/x');

    const result = await bash(repo, 'echo $(( $(date +%s) + 1 )); cat .oss/tool-gates.json');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("can't be read");
  });

  it.each([
    ['a ${…} that runs a harmless command, on its own', 'echo ${x:-$(date)}'],
    ['a loop over a brace sequence', 'for i in {1..3}; do echo $i; done'],
  ])('should allow %s', async (_what, command) => {
    const repo = makeRepo('feat/x');

    const result = await bash(repo, command);

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('should log an allowed command with an unreadable piece as unreadable', async () => {
    const repo = makeRepo('feat/x');

    await bash(repo, 'echo ${x:-$(date)}');

    expect(events(repo)).toEqual([expect.objectContaining({ kind: 'unreadable', result: 'allowed' })]);
  });
});

describe('tool-gate: refusal text', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should show unknown text as … and never the placeholder with its NUL characters', async () => {
    const repo = makeRepo('feat/x');

    const result = await bash(repo, 'echo x > .oss/tool-gates/$(date +%s)');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain('\u0000');
    expect(result.stderr).toContain('.oss/tool-gates/…');
  });
});

describe('unreadable rule: a wildcard word judged on its text (fix round 4, K2)', () => {
  const SETTINGS: GateSettings = {
    version: 1,
    protectedBranches: ['main'],
    testFilePatterns: [],
    testCommandPatterns: [],
    sourceExtensions: [],
    protectedPaths: ['.oss/tool-gates.json', '.oss/tool-gates/**', '~/.claude/settings*.json'],
    productionHosts: [],
    gateAgents: [],
    tagsAllowed: true,
  };
  const ROOT = '/work/repo';
  const HOME = '/home/dev';

  const risky = (cmd: string) => {
    const result = readCommand(cmd, ROOT, HOME);
    if (!('unreadable' in result)) throw new Error('expected an unreadable command');
    return checkUnreadable(result.reason, result.parts, SETTINGS, ROOT, HOME, false);
  };

  it.each([
    'echo ${X:-$(date)}; cat .os?/tool-gates.json',
    'echo ${X:-$(date)}; cat .oss/tool-gate[s].json',
    'echo ${X:-$(date)}; ls .oss/*',
    'echo ${X:-$(date)}; cat ~/.claude/settings.*',
    'shopt -s dotglob; echo ${X:-$(date)}; ls *',
    'echo ${X:-$(date)}; ls *(D)',
  ])('should refuse %s', (cmd) => {
    expect(risky(cmd)?.rule).toBe('unreadable');
  });

  it.each(['echo ${X:-$(date)}; cat src/*.ts', 'echo ${X:-$(date)}; ls *'])('should allow %s', (cmd) => {
    expect(risky(cmd)).toBeNull();
  });
});

describe('unreadable rule: a sed or awk script that runs a command the gate cannot read (fix round 4, K2)', () => {
  const SETTINGS: GateSettings = {
    version: 1,
    protectedBranches: ['main'],
    testFilePatterns: [],
    testCommandPatterns: [],
    sourceExtensions: [],
    protectedPaths: ['.oss/tool-gates.json'],
    productionHosts: [],
    gateAgents: [],
    tagsAllowed: true,
  };
  const check = (cmd: string) => {
    const result = readCommand(cmd, '/work/repo', '/home/dev');
    if (!('unreadable' in result)) throw new Error('expected an unreadable command');
    return checkUnreadable(result.reason, result.parts, SETTINGS, '/work/repo', '/home/dev', false);
  };

  it.each([`sed 'e' f`, `sed 's/.*/x/e' f`, `awk '{system($0)}' f`, `awk '{print > $2}' f`])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('unreadable');
  });

  it('should allow sed with a plain script next to an unreadable piece', () => {
    expect(check('echo ${X:-$(date)}; sed -n 1p f')).toBeNull();
  });
});

describe('unreadable rule: a sed script or interpreter script only known when it runs (fix round 4, K3)', () => {
  const SETTINGS: GateSettings = {
    version: 1,
    protectedBranches: ['main'],
    testFilePatterns: [],
    testCommandPatterns: [],
    sourceExtensions: [],
    protectedPaths: ['.oss/tool-gates.json'],
    productionHosts: [],
    gateAgents: [],
    tagsAllowed: true,
  };
  const read = (cmd: string) => readCommand(cmd, '/work/repo', '/home/dev');
  const check = (cmd: string) => {
    const result = read(cmd);
    if (!('unreadable' in result)) throw new Error('expected an unreadable command');
    return checkUnreadable(result.reason, result.parts, SETTINGS, '/work/repo', '/home/dev', false);
  };

  it.each(['sed "s/a/$X/" f', 'sed -e "$S" f', `sed "$(cat s)" f`, 'awk "{print $1}" f'])('should read %s as unreadable, and allow it alone', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['sed "s/a/$X/" f && git push', 'sed -e "$S" f; python3 x.py', 'sed "1e $C" f', `awk "BEGIN{system(\\"$C\\")}"`])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('unreadable');
    },
  );

  it.each(['python3 <(curl -s x)', 'node <(cat x.js)', 'bash <(curl x)', 'python3 "$S"', 'sh $X', 'python3 -c "$C"', 'node -e "$C"', 'ruby "$R"'])(
    'should refuse %s: the interpreter runs a script only known when it runs',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('unreadable');
    },
  );

  it.each(['python3 script.py', 'node x.js', 'python3 script.py "$ARG"', 'bash ./run.sh "$X"', 'sed -f s.sed f', 'awk -f s.awk f', "sed 's/a/b/' f", 'bash -s "$X" <<< "echo hi"'])(
    'should read %s',
    (cmd) => {
      expect('unreadable' in read(cmd)).toBe(false);
    },
  );
});
