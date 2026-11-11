/**
 * @behavior On macOS and Windows the default file systems ignore letter case, so
 *   `~/.Claude/Settings.json` or `.OSS/tool-gates.json` is the same file as the protected one.
 *   There the gate compares protected paths without regard to case, and refuses those writes.
 *   On Linux, where case matters, `.OSS/x` is a different file and is left alone. A source file
 *   is recognised by its extension in any case (`foo.TS`), so the RED rule covers it too, and a
 *   test file written with a different case (`foo.TEST.ts`) still can't gain a `.only(`.
 * @business-rule US-006: a protected file can't be reached by changing letter case. US-004:
 *   changing the case of an extension doesn't skip the failing-test rule. US-003: changing the
 *   case of a test file's name doesn't let a focus marker in.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/** A throwaway git repo on a feature branch, and an empty home folder. */
function makeRepo(): { repo: string; home: string } {
  const repo = tempDir('oss-tool-gate-case-');
  for (const args of [
    ['init', '-q', '-b', 'feat/x'],
    ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'initial'],
  ]) {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  }
  return { repo, home: tempDir('oss-tool-gate-case-home-') };
}

function startBuild(repo: string): void {
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.oss', 'workflow-state.json'),
    JSON.stringify({ currentCommand: 'build', currentCommandStartedAt: '2026-11-09T00:00:00.000Z' }),
  );
}

function pre(
  repo: string,
  home: string,
  platform: NodeJS.Platform,
  toolName: string,
  toolInput: object,
): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ cwd: repo, hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo },
    },
    { platform },
  );
}

describe('protected paths on a case-insensitive file system (macOS, Windows)', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    it(`refuses an Edit of ~/.Claude/Settings.json on ${platform}`, async () => {
      const { repo, home } = makeRepo();
      const result = await pre(repo, home, platform, 'Edit', {
        file_path: path.join(home, '.Claude', 'Settings.json'),
        old_string: 'a',
        new_string: 'b',
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('protected file');
    });
  }

  it('refuses a Bash redirect into .OSS/tool-gates.json', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'darwin', 'Bash', { command: 'echo {} > .OSS/tool-gates.json' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('protected file');
  });

  it('refuses rm -rf .OSS/tool-gates, which removes the protected state folder', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'darwin', 'Bash', { command: 'rm -rf .OSS/tool-gates' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('holds protected files');
  });

  it('refuses an Edit of .oss/TOOL-GATES/cycle.json', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'darwin', 'Edit', {
      file_path: path.join(repo, '.oss', 'TOOL-GATES', 'cycle.json'),
      old_string: 'red',
      new_string: 'green',
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('protected file');
  });

  it('refuses a Write of .Claude/settings.local.json in the repo', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'darwin', 'Write', {
      file_path: path.join(repo, '.Claude', 'settings.local.json'),
      content: '{}',
    });
    expect(result.exitCode).toBe(2);
  });
});

describe('protected paths on a case-sensitive file system (Linux)', () => {
  it('allows a Write of .OSS/x, which is a different file from .oss/x there', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'linux', 'Write', {
      file_path: path.join(repo, '.OSS', 'tool-gates.json'),
      content: '{}',
    });
    expect(result.exitCode).toBe(0);
  });

  it('still refuses the protected file written in its own case', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'linux', 'Write', {
      file_path: path.join(repo, '.oss', 'tool-gates.json'),
      content: '{}',
    });
    expect(result.exitCode).toBe(2);
  });
});

describe('source and test files whatever the case of their names', () => {
  it('refuses an edit of src/foo.TS during a build with no failing test run', async () => {
    const { repo, home } = makeRepo();
    startBuild(repo);
    const result = await pre(repo, home, 'darwin', 'Write', {
      file_path: path.join(repo, 'src', 'foo.TS'),
      content: 'export const a = 1;\n',
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('No failing test recorded');
  });

  it('refuses adding .only( to src/foo.TEST.ts on a case-insensitive file system', async () => {
    const { repo, home } = makeRepo();
    const result = await pre(repo, home, 'darwin', 'Write', {
      file_path: path.join(repo, 'src', 'foo.TEST.ts'),
      content: "it.only('x', () => {});\n",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('.only(');
  });
});
