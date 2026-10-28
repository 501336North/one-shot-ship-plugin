/**
 * invokeCommand runs the OSS hook scripts without a shell (FR9).
 *
 * @behavior A team command name or an API error message containing shell syntax (a quote, `;`,
 *           `$(...)`) is passed to oss-log.sh / oss-notify.sh as plain data and never runs as a command.
 * @business-rule Nothing from the dashboard or the API server is ever interpreted by a shell; an
 *           unsafe command name is refused before any hook script runs.
 * @boundary Real child processes and real hook scripts under a temp HOME; only fetch (the API) is
 *           stubbed. The proof that nothing ran is a marker file the injected command would create.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CustomCommandExecutor } from '../../src/engine/custom-command-executor.js';

let home: string;
let marker: string;
let argvLog: string;
let savedHome: string | undefined;
let savedConfigDir: string | undefined;

/** A hook script that records each argument on its own line, so the test can see what it was given */
function writeRecordingHook(name: string): void {
  const script = path.join(home, '.oss', 'hooks', name);
  fs.writeFileSync(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\n`, {
    mode: 0o755,
  });
}

function apiAnswers(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body })
  );
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedConfigDir = process.env.OSS_CONFIG_DIR;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-fr9-'));
  marker = path.join(home, 'PWNED');
  argvLog = path.join(home, 'argv.log');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.oss', 'config.json'),
    JSON.stringify({ apiKey: 'k', apiUrl: 'https://one-shot-ship-api-staging.onrender.com' }),
    { mode: 0o600 }
  );
  writeRecordingHook('oss-log.sh');
  writeRecordingHook('oss-notify.sh');
  process.env.HOME = home;
  delete process.env.OSS_CONFIG_DIR;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.HOME = savedHome;
  if (savedConfigDir === undefined) delete process.env.OSS_CONFIG_DIR;
  else process.env.OSS_CONFIG_DIR = savedConfigDir;
  fs.rmSync(home, { recursive: true, force: true });
});

// Each case spawns up to three real hook processes; a loaded machine needs more than vitest's 5s.
describe('invokeCommand: no shell interpolation (FR9)', { timeout: 30_000 }, () => {
  it.each([
    ['a single quote and ;', (m: string) => `x';touch ${m};'`],
    ['$(...)', (m: string) => `$(touch ${m})`],
    ['a backtick', (m: string) => `\`touch ${m}\``],
  ])('should refuse a command name with %s and run nothing', async (_label, hostile) => {
    apiAnswers(200, { prompt: 'p', name: 'x' });

    const result = await new CustomCommandExecutor().invokeCommand(hostile(marker));

    expect(result.success).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(argvLog)).toBe(false);
  });

  it.each([
    ['a single quote and ;', (m: string) => `'; touch ${m}; echo '`],
    ['$(...)', (m: string) => `'$(touch ${m})'`],
  ])('should pass an API error with %s to oss-notify.sh as data, not run it', async (_label, hostile) => {
    const error = hostile(marker);
    apiAnswers(500, { error });

    const result = await new CustomCommandExecutor().invokeCommand('review-standards');

    expect(result.success).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    const recorded = fs.readFileSync(argvLog, 'utf8');
    expect(recorded).toContain(JSON.stringify({ command: 'review-standards', error }));
  });

  it('should still give the hooks their usual arguments for a safe command', async () => {
    apiAnswers(200, { prompt: 'p', name: 'review-standards' });

    const result = await new CustomCommandExecutor().invokeCommand('review-standards');

    expect(result.success).toBe(true);
    expect(fs.readFileSync(argvLog, 'utf8').split('\n')).toEqual([
      'init',
      'custom',
      '--workflow',
      'custom',
      'start',
      '{"command":"review-standards"}',
      '--workflow',
      'custom',
      'complete',
      '{"command":"review-standards"}',
      '',
    ]);
  });
});
