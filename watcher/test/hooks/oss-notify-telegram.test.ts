/**
 * @behavior Finishing a command never sends anything to Telegram, even for a user whose saved
 *           settings still say Telegram notifications are on.
 * @business-rule The customer Telegram bot is retired; the plugin hooks have no Telegram path left.
 * @boundary Shell script (oss-notify.sh) -> any `node` CLI it runs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-notify.sh sends nothing to Telegram', () => {
  const PLUGIN_ROOT = path.resolve(__dirname, '../../..');
  const OSS_NOTIFY = path.join(PLUGIN_ROOT, 'hooks/oss-notify.sh');

  // Sandbox: temp HOME and a fake plugin root; a fake `node` on PATH records every call.
  let sandbox: string;
  let callsFile: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notify-no-telegram-'));
    callsFile = path.join(sandbox, 'node.calls');
    const cliDir = path.join(sandbox, 'plugin/watcher/dist/cli');
    fs.mkdirSync(path.join(sandbox, 'home/.oss'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'plugin/hooks'), { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'bin'), { recursive: true });

    fs.writeFileSync(path.join(sandbox, 'plugin/hooks/oss-log.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(sandbox, 'bin/node'),
      `#!/bin/bash\necho "$*" >> "${callsFile}"\nexit 0\n`,
      { mode: 0o755 }
    );
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
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  function nodeCalls(): string[] {
    if (!fs.existsSync(callsFile)) return [];
    return fs.readFileSync(callsFile, 'utf-8').split('\n').filter((line) => line);
  }

  it('never runs telegram-notify.js when a command completes with Telegram enabled in settings', () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: path.join(sandbox, 'home'),
      CLAUDE_PLUGIN_ROOT: path.join(sandbox, 'plugin'),
      CLAUDE_PROJECT_DIR: '',
      OSS_SKIP_WATCHER: '1',
      PATH: `${path.join(sandbox, 'bin')}:${process.env.PATH ?? ''}`,
    };

    try {
      execFileSync('bash', [OSS_NOTIFY, '--workflow', 'build', 'complete', '{"testsPass": 47}'], {
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
    expect(calls.filter((c) => c.includes('telegram-notify.js'))).toEqual([]);
  });

  it('has no Telegram code left in oss-notify.sh', () => {
    const source = fs.readFileSync(OSS_NOTIFY, 'utf-8');
    // Anchor: the real hook was read.
    expect(source.split('\n').length).toBeGreaterThan(100);
    expect(source).not.toMatch(/telegram/i);
  });
});
