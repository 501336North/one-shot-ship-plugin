/**
 * @behavior oss-log.sh recovery and timeout actions log to session.log
 * @acceptance-criteria Supervisor can see error recovery and timeout events
 * @business-rule Every error recovery attempt and timeout must be visible in session.log
 * @boundary Shell script (oss-log.sh)
 *
 * Every run is sandboxed by this file itself, whatever setup.ts does: HOME is a fresh temp dir and
 * the cwd is a dir with its own `.git` and no `.oss`, so no project is ever resolved (the global log).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');

interface Sandbox {
  root: string;
  home: string;
  cwd: string;
  logsDir: string;
}

function makeSandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-recovery-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'work');
  fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
  // A repo root with no .oss: the project walk stops here, so no ancestor .oss is picked up.
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  return { root, home, cwd, logsDir: path.join(home, '.oss', 'logs', 'current-session') };
}

function runOssLog(sandbox: Sandbox, args: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: sandbox.home };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_CODE_SESSION_ID;
  return execSync(`bash "${ossLogScript}" ${args}`, {
    cwd: sandbox.cwd,
    env,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sessionLogOf(sandbox: Sandbox): string {
  return fs.readFileSync(path.join(sandbox.logsDir, 'session.log'), 'utf-8');
}

function usageErrorOf(sandbox: Sandbox, args: string): string {
  try {
    runOssLog(sandbox, args);
  } catch (error) {
    return (error as { stderr?: string }).stderr || '';
  }
  return '';
}

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = makeSandbox();
});

afterEach(() => {
  fs.rmSync(sandbox.root, { recursive: true, force: true });
});

describe('oss-log-error-recovery test isolation', () => {
  /**
   * @behavior running this file's hook calls never changes the logs of the HOME it was started from
   * @business-rule a test must not write fixture lines into the user's ~/.oss/logs
   */
  it('should leave logs outside its sandbox untouched', () => {
    const savedHome = process.env.HOME;
    const parentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-t12-parent-home-'));
    const parentLogs = path.join(parentHome, '.oss', 'logs', 'current-session');
    fs.mkdirSync(parentLogs, { recursive: true });
    const sentinels: Record<string, string> = {
      'build.log': 'SENTINEL build.log line\n',
      'session.log': 'SENTINEL session.log line\n',
    };
    for (const [name, content] of Object.entries(sentinels)) {
      fs.writeFileSync(path.join(parentLogs, name), content);
    }
    process.env.HOME = parentHome; // stands in for the user's HOME
    try {
      runOssLog(sandbox, 'recovery build "Retrying after error" "attempt=2"');
      runOssLog(sandbox, 'timeout build "Process hung after 60s" "pid=12345"');
    } finally {
      process.env.HOME = savedHome;
    }
    const after = Object.fromEntries(
      Object.keys(sentinels).map((name) => [name, fs.readFileSync(path.join(parentLogs, name), 'utf-8')]),
    );
    fs.rmSync(parentHome, { recursive: true, force: true });
    expect(after).toEqual(sentinels);
  });
});

describe('oss-log.sh recovery action', () => {
  /**
   * @behavior recovery action logs with command and attempt details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [RECOVERY] message details
   */
  it('should log recovery attempt with command and details', () => {
    runOssLog(sandbox, 'recovery build "Retrying after error" "attempt=2"');

    expect(sessionLogOf(sandbox)).toMatch(
      /\[\d{2}:\d{2}:\d{2}\] \[build\] \[RECOVERY\] Retrying after error attempt=2/,
    );
  });

  /**
   * @behavior recovery action logs without details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [RECOVERY] message
   */
  it('should log recovery attempt without details', () => {
    runOssLog(sandbox, 'recovery plan "Fallback to synchronous execution"');

    expect(sessionLogOf(sandbox)).toMatch(
      /\[\d{2}:\d{2}:\d{2}\] \[plan\] \[RECOVERY\] Fallback to synchronous execution/,
    );
  });

  /**
   * @behavior recovery action requires command argument
   * @acceptance-criteria Command fails with usage message if command missing
   */
  it('should show usage error when command is missing', () => {
    const errorOutput = usageErrorOf(sandbox, 'recovery');

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('recovery');
  });
});

describe('oss-log.sh timeout action', () => {
  /**
   * @behavior timeout action logs with command and process details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [TIMEOUT] message details
   */
  it('should log timeout with command and details', () => {
    runOssLog(sandbox, 'timeout build "Process hung after 60s" "pid=12345"');

    expect(sessionLogOf(sandbox)).toMatch(
      /\[\d{2}:\d{2}:\d{2}\] \[build\] \[TIMEOUT\] Process hung after 60s pid=12345/,
    );
  });

  /**
   * @behavior timeout action logs without details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [TIMEOUT] message
   */
  it('should log timeout without details', () => {
    runOssLog(sandbox, 'timeout ship "Test runner exceeded timeout"');

    expect(sessionLogOf(sandbox)).toMatch(
      /\[\d{2}:\d{2}:\d{2}\] \[ship\] \[TIMEOUT\] Test runner exceeded timeout/,
    );
  });

  /**
   * @behavior timeout action requires command argument
   * @acceptance-criteria Command fails with usage message if command missing
   */
  it('should show usage error when command is missing', () => {
    const errorOutput = usageErrorOf(sandbox, 'timeout');

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('timeout');
  });
});
