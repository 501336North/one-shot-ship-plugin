/**
 * @behavior Finishing a command never sends anything to Telegram, even for a user whose saved
 *           settings still say Telegram notifications are on.
 * @business-rule The customer Telegram bot is retired; the plugin hooks have no Telegram path left.
 * @boundary Shell script (oss-notify.sh) -> any `node` CLI it runs
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

describe('oss-notify.sh sends nothing to Telegram', () => {
  const PLUGIN_ROOT = path.resolve(__dirname, '../../..');
  const OSS_NOTIFY = path.join(PLUGIN_ROOT, 'hooks/oss-notify.sh');

  // Sandbox, built once per file: temp HOME and a fake plugin root; a fake `node` on PATH records
  // every call. The stubs are created and warmed in beforeAll so the macOS first-exec scan never
  // lands inside a test; no executable is created after it.
  let sandbox: string;
  let callsFile: string;

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notify-no-telegram-'));
    const cliDir = path.join(sandbox, 'plugin/watcher/dist/cli');
    fs.mkdirSync(path.join(sandbox, 'home/.oss'), { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });

    writeWarmStub(path.join(sandbox, 'plugin/hooks/oss-log.sh'), 'exit 0\n');
    // Env contract: NODE_CALLS = the calls file of the test that runs the hook.
    writeWarmStub(path.join(sandbox, 'bin/node'), 'echo "$*" >> "$NODE_CALLS"\nexit 0\n');
    // An old install may still have the Telegram CLI on disk.
    for (const cli of ['update-workflow-state.js', 'chain-trigger.cjs', 'telegram-notify.js']) {
      fs.writeFileSync(path.join(cliDir, cli), '');
    }
    fs.writeFileSync(
      path.join(sandbox, 'home/.oss/settings.json'),
      JSON.stringify({
        notifications: { style: 'telegram', verbosity: 'all', telegram: { linked: true, enabled: true } },
      })
    );
  }, WARMUP_TIMEOUT_MS);

  let testIndex = 0;
  beforeEach(() => {
    testIndex += 1;
    callsFile = path.join(sandbox, `node-${testIndex}.calls`);
  });

  afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  function nodeCalls(): string[] {
    if (!fs.existsSync(callsFile)) return [];
    return fs.readFileSync(callsFile, 'utf-8').split('\n').filter((line) => line);
  }

  it.each(['build', 'ship'])(
    'never runs telegram-notify.js when /oss:%s completes with Telegram enabled in settings',
    (workflow) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: path.join(sandbox, 'home'),
        CLAUDE_PLUGIN_ROOT: path.join(sandbox, 'plugin'),
        CLAUDE_PROJECT_DIR: '',
        OSS_SKIP_WATCHER: '1',
        NODE_CALLS: callsFile,
        PATH: `${path.join(sandbox, 'bin')}:${process.env.PATH ?? ''}`,
      };

      try {
        execFileSync('bash', [OSS_NOTIFY, '--workflow', workflow, 'complete', '{"testsPass": 47}'], {
          cwd: sandbox,
          env,
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        // the hook's exit code is not under test here
      }

      const calls = nodeCalls();
      // Anchor: the hook really ran its node CLIs (otherwise "no Telegram call" proves nothing).
      expect(calls.some((c) => c.includes('update-workflow-state.js'))).toBe(true);
      // The stubs are shared by every test: this test's calls file holds this run only.
      expect(calls.filter((c) => c.includes('setLastCommand'))).toEqual([
        expect.stringMatching(new RegExp(` setLastCommand ${workflow}$`)),
      ]);
      expect(calls.filter((c) => c.includes('telegram-notify.js'))).toEqual([]);
    }
  );

  it('has no Telegram code left in oss-notify.sh', () => {
    const source = fs.readFileSync(OSS_NOTIFY, 'utf-8');
    // Anchor: the real hook was read.
    expect(source.split('\n').length).toBeGreaterThan(100);
    expect(source).not.toMatch(/telegram/i);
  });
});
