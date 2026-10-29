/**
 * @behavior Session start/end hooks log to session.log for supervisor visibility
 * @acceptance-criteria Supervisor can see session lifecycle events
 * @business-rule Every session start/end must be visible in session.log
 * @boundary Shell scripts (oss-session-start.sh, oss-session-end.sh)
 *
 * Hermetic (T11): everything happens inside this file's sandbox.
 * - HOME is the per-file temp HOME from test/setup.ts, with a FAKE apiKey whose apiUrl is unroutable.
 * - CLAUDE_CODE_SESSION_ID is an id this file owns, never the live session's.
 * - A recording `curl` stub never reaches the network. Bash hooks get it as an exported function that
 *   runs the stub through `bash` (a fresh executable's first direct exec costs macOS 1-60 s of
 *   policy scanning; `bash <file>` costs nothing). It is also first on PATH for any other caller.
 * - The manifest check is off (OSS_SKIP_MANIFEST) and the Claude Code version is pinned
 *   (OSS_TEST_CC_VERSION), so no real host and no real `claude` binary is touched.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PLUGIN_ROOT = path.join(__dirname, '../../..');
// HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
const HOOKS_DIR = process.env.HOOKS_UNDER_TEST ?? path.join(PLUGIN_ROOT, 'hooks');
const SESSION_START = path.join(HOOKS_DIR, 'oss-session-start.sh');
const SESSION_END = path.join(HOOKS_DIR, 'oss-session-end.sh');
const SANDBOX_API_URL = 'http://127.0.0.1:9';
const HOOK_TIMEOUT_MS = 10000;
// A start or end run costs about 1 s warm (bash + a few node CLI calls); the budget leaves room
// for a loaded machine without depending on vitest's 5 s default.
const TEST_TIMEOUT_MS = 15000;

const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Each test is its own session: a pointer one test leaves behind must not route another test's logs.
let testCount = 0;
let ownSessionId = '';
const otherSessionId = `other-live-session-${testId}`;

let sandbox: string;
let home: string;
let loggedOutHome: string;
let stubBin: string;
let stubScript: string;
let curlLog: string;

function writeOssHome(dir: string, loggedIn: boolean): void {
  fs.mkdirSync(path.join(dir, '.oss', 'logs', 'current-session'), { recursive: true, mode: 0o700 });
  if (loggedIn) {
    fs.writeFileSync(
      path.join(dir, '.oss', 'config.json'),
      JSON.stringify({ apiKey: 'fake-test-key-not-real', apiUrl: SANDBOX_API_URL }),
      { mode: 0o600 },
    );
  }
}

function hookEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${stubBin}:${process.env.PATH ?? ''}`,
    'BASH_FUNC_curl%%': `() { bash '${stubScript}' "$@"; }`,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    CLAUDE_CODE_SESSION_ID: ownSessionId,
    OSS_SKIP_WATCHER: '1',
    OSS_SKIP_MANIFEST: '1',
    OSS_TEST_CC_VERSION: '9.9.9',
  };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.OSS_CONFIG_DIR;
  delete env.OSS_MANIFEST_URL;
  delete env.OSS_MOCK_MANIFEST;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runHook(script: string, cwd: string, overrides: Record<string, string | undefined> = {}): void {
  try {
    execSync(`bash "${script}"`, {
      cwd,
      encoding: 'utf-8',
      env: hookEnv(overrides),
      input: '',
      stdio: 'pipe',
      timeout: HOOK_TIMEOUT_MS,
    });
  } catch {
    // The hooks never fail a session; the assertions below read what they wrote.
  }
}

/**
 * Runs a hook and waits for every job it started. Fd 3 is an extra pipe that the hook and the jobs
 * it detaches (`</dev/null >/dev/null 2>&1 &` leaves fd 3 alone) all inherit, and execSync returns
 * only when every writer has closed it. Returns false if that did not happen within HOOK_TIMEOUT_MS.
 */
function runHookAndJobs(script: string, cwd: string, overrides: Record<string, string | undefined> = {}): boolean {
  try {
    execSync(`bash "${script}"`, {
      cwd,
      encoding: 'utf-8',
      env: hookEnv(overrides),
      input: '',
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      timeout: HOOK_TIMEOUT_MS,
    });
  } catch (error) {
    // A non-zero exit is fine (the hooks never fail a session); not finishing in time is not.
    if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') return false;
  }
  return true;
}

function makeGitProject(name: string, branch?: string): string {
  const dir = path.join(sandbox, name);
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir, stdio: 'pipe', env: { ...process.env, HOME: home } });
  if (branch) execSync(`git checkout -q -b ${branch}`, { cwd: dir, stdio: 'pipe', env: { ...process.env, HOME: home } });
  return dir;
}

function sessionLog(dir: string = home): string {
  const file = path.join(dir, '.oss', 'logs', 'current-session', 'session.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

function recordedCurlUrls(): string[] {
  if (!fs.existsSync(curlLog)) return [];
  return fs.readFileSync(curlLog, 'utf-8').split('\n').filter(Boolean);
}

beforeAll(() => {
  home = os.homedir(); // the temp HOME test/setup.ts gives this file
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-logging-'));
  loggedOutHome = path.join(sandbox, 'home-logged-out');
  writeOssHome(home, true);
  writeOssHome(loggedOutHome, false);

  // Recording curl stub: logs every URL it is given, then fails as an unreachable host would.
  stubBin = path.join(sandbox, 'bin');
  curlLog = path.join(sandbox, 'curl-calls.log');
  fs.mkdirSync(stubBin, { recursive: true });
  stubScript = path.join(stubBin, 'curl');
  fs.writeFileSync(
    stubScript,
    [
      '#!/bin/bash',
      'for a in "$@"; do',
      `  case "$a" in http://*|https://*) printf '%s\\n' "$a" >> "${curlLog}" ;; esac`,
      'done',
      'exit 7',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  // Warm it once, the way the hooks reach it, then start from an empty record.
  try { execSync(`bash -c 'curl ${SANDBOX_API_URL}/warm'`, { stdio: 'pipe', env: hookEnv({}) }); } catch { /* exit 7 */ }
  expect(recordedCurlUrls()).toEqual([`${SANDBOX_API_URL}/warm`]);
  fs.rmSync(curlLog, { force: true });
});

beforeEach(() => {
  testCount += 1;
  ownSessionId = `oss-session-logging-${testId}-${testCount}`;
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('oss-session-start.sh logging', () => {
  /**
   * @behavior Session start logs hook execution to session.log, even before login is checked
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START] oss-session-start
   */
  it('should log hook START event for session start', { timeout: TEST_TIMEOUT_MS }, () => {
    // GIVEN: a user who is not logged in, outside any project
    const cwd = fs.mkdtempSync(path.join(sandbox, 'no-project-'));
    const marker = `[TEST-MARKER-START-${testId}]`;
    fs.appendFileSync(path.join(loggedOutHome, '.oss', 'logs', 'current-session', 'session.log'), `\n${marker}\n`);

    // WHEN: session start runs with hook logging on
    runHook(SESSION_START, cwd, { HOME: loggedOutHome, OSS_SKIP_HEALTH_CHECK: '' });

    // THEN: the hook START entry follows the marker
    const log = sessionLog(loggedOutHome);
    expect(log.slice(log.lastIndexOf(marker))).toMatch(/\[hook\].*\[START\].*oss-session-start/);
  });

  /**
   * @behavior Session start logs session event with project info
   * @acceptance-criteria Format: [HH:MM:SS] [session] [START] project=... branch=...
   */
  it('should log session START event with project metadata', { timeout: TEST_TIMEOUT_MS }, () => {
    // GIVEN: a logged-in user in a git project on test-branch
    const project = makeGitProject(`start-project-${testId}`, 'test-branch');

    // WHEN: session start runs for that project
    runHook(SESSION_START, project, { CLAUDE_PROJECT_DIR: project });

    // THEN: the session START line names the project and branch
    expect(sessionLog()).toMatch(
      new RegExp(`\\[session\\].*\\[START\\].*project=${path.basename(project)} branch=test-branch`),
    );
  });
});

describe('oss-session-end.sh logging', () => {
  /**
   * @behavior Session end logs hook execution to session.log
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-session-end
   */
  it('should log hook events for session end', { timeout: TEST_TIMEOUT_MS }, () => {
    // GIVEN: a git directory but no known project
    const dir = makeGitProject(`end-no-project-${testId}`);
    const marker = `[TEST-MARKER-END-HOOK-${testId}]`;
    fs.appendFileSync(path.join(home, '.oss', 'logs', 'current-session', 'session.log'), `\n${marker}\n`);

    // WHEN: session end runs with hook logging on
    runHook(SESSION_END, dir, { OSS_SKIP_HEALTH_CHECK: '' });

    // THEN: with no project known it creates no stray .oss in the cwd (ship round 1, R1-4), so its
    // hook entries land in the global session log
    expect(fs.existsSync(path.join(dir, '.oss'))).toBe(false);
    const log = sessionLog();
    expect(log.slice(log.lastIndexOf(marker))).toMatch(/\[hook\].*oss-session-end/);
  });

  /**
   * @behavior Session end logs session END event
   * @acceptance-criteria Format: [HH:MM:SS] [session] [END] ...
   */
  it('should log session END event', { timeout: TEST_TIMEOUT_MS }, () => {
    // GIVEN: a git project
    const project = makeGitProject(`end-project-${testId}`);

    // WHEN: session end runs for that project
    runHook(SESSION_END, project, { CLAUDE_PROJECT_DIR: project });

    // THEN: the session END line names the project
    expect(sessionLog()).toMatch(new RegExp(`\\[session\\].*\\[END\\].*project=${path.basename(project)}`));
  });

  /**
   * @behavior Ending one session never forgets which project another open session is in
   * @business-rule Session end removes only its own ~/.oss/sessions/<id> pointer
   */
  it('should only remove its own session pointer', { timeout: TEST_TIMEOUT_MS }, () => {
    // GIVEN: this session and another one both started in the project, so each has a pointer,
    // stored the way session start stores it
    const project = makeGitProject(`pointer-project-${testId}`);
    fs.mkdirSync(path.join(project, '.oss'), { recursive: true });
    runHook(SESSION_START, project, { CLAUDE_PROJECT_DIR: project });
    runHook(SESSION_START, project, { CLAUDE_PROJECT_DIR: project, CLAUDE_CODE_SESSION_ID: otherSessionId });
    const ownPointer = path.join(home, '.oss', 'sessions', ownSessionId, 'project');
    const otherPointer = path.join(home, '.oss', 'sessions', otherSessionId, 'project');
    expect(fs.readFileSync(ownPointer, 'utf-8').trim()).toBe(project);
    expect(fs.readFileSync(otherPointer, 'utf-8').trim()).toBe(project);

    // WHEN: this session ends
    runHook(SESSION_END, project, { CLAUDE_PROJECT_DIR: project });

    // THEN: the other session's pointer is still there and its own pointer is gone
    expect(fs.existsSync(otherPointer)).toBe(true);
    expect(fs.existsSync(ownPointer)).toBe(false);
  });
});

describe('session hooks stay off the network', () => {
  /**
   * @behavior Running the session hooks in a test never reaches a real server, including the work
   *           they start in the background (the Iron Laws refresh, the session notification)
   * @business-rule Every request goes to the sandbox's unroutable apiUrl, through the recording stub
   */
  it('should make no network calls', { timeout: 2 * HOOK_TIMEOUT_MS + TEST_TIMEOUT_MS }, () => {
    // GIVEN: a logged-in project (on top of every hook run this file has already made), with the
    // network paths live: test/setup.ts turns them off for every other test (OSS_SKIP_HEALTH_CHECK)
    const project = makeGitProject(`network-project-${testId}`);
    const live = { CLAUDE_PROJECT_DIR: project, OSS_SKIP_HEALTH_CHECK: '' };

    // WHEN: a session starts and ends there, and every job the hooks started has finished
    expect(runHookAndJobs(SESSION_START, project, live)).toBe(true);
    expect(runHookAndJobs(SESSION_END, project, live)).toBe(true);

    // THEN: the hooks did make requests (the subscription check), and every one was the stub,
    // aimed at the sandbox apiUrl
    const urls = recordedCurlUrls();
    expect(urls).toContain(`${SANDBOX_API_URL}/api/v1/subscription/status`);
    expect(urls.filter((url) => !url.startsWith(`${SANDBOX_API_URL}/`))).toEqual([]);
  });
});
