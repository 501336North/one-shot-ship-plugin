/**
 * @behavior When a session starts, the subscription check asks the API the user configured
 *   (apiUrl in ~/.oss/config.json), or the default API when none is set. When apiUrl is invalid,
 *   no subscription request is made, and session start still finishes normally.
 * @business-rule The API key goes only to the configured API: the same URL rule (oss_api_url) that
 *   every other keyed call uses. No call during session start may send it to the default host when
 *   the user set an apiUrl.
 *   Plain http to a loopback apiUrl is used only with OSS_ALLOW_HTTP_LOOPBACK=1 (T20); without it, no request
 *   is made and session start prints one line naming the switch, so a local dev setup says why it went quiet.
 * @boundary hooks/oss-session-start.sh, run as Claude Code runs it.
 *
 * Hermetic:
 * - per-test HOME (mkdtemp, .oss at 0700) and project cwd; CLAUDE_*, OSS_* and CURL* are removed from
 *   the child env (that includes CLAUDE_CODE_SESSION_ID, CLAUDE_PROJECT_DIR and OSS_CONFIG_DIR).
 *   OSS_SKIP_WATCHER=1 is set. OSS_SKIP_HEALTH_CHECK stays unset, because the subscription check runs
 *   only when it is not "1"; OSS_RUN_HEALTH_CHECK stays unset, so the opt-in test run does not start.
 * - a sandbox bin/ first on PATH: a recording `curl` (one line of argv per call in a per-test file, and
 *   its stdin, where oss_api_curl writes the `header = "Authorization: Bearer <key>"` config, in a second
 *   file; prints {"status":"active"}), a recording `node` (argv per call, exits 0) and no-op `claude`, `say`
 *   and `afplay`. Stubs are warmed once in beforeAll.
 * - OSS_ALLOW_HTTP_LOOPBACK=1 is set only by the tests that expect a request to a loopback http apiUrl, so
 *   the tests without it prove the refusal.
 * - OSS_CONFIG_DIR is set only by the tests that pass a configDir: the key, and the URL it goes to, must
 *   both come from that one file (oss_config_file).
 * - the hook runs from a sandbox plugin root (CLAUDE_PLUGIN_ROOT) whose hooks/ is a SYMLINK to the real
 *   hooks dir, or to OSS_TEST_HOOKS_DIR (used to run mutants). Not a copy: copied scripts are new files,
 *   and the macOS first-exec scan of each one cost up to minutes under parallel load. The hooks resolve
 *   the plugin root logically (cd + pwd, CLAUDE_PLUGIN_ROOT), so the root stays the sandbox, which has no
 *   watcher/dist: the node stub proves no watcher CLI runs.
 * - fd 3 is an extra pipe; the hook's detached jobs (notify, iron-laws sync) inherit it, so spawnSync
 *   returns only after they all exit and the curl record is complete. The timeout is a hang backstop.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

const HOOKS_SOURCE = process.env.OSS_TEST_HOOKS_DIR ?? path.join(__dirname, '../../../hooks');
const DEFAULT_HOST = 'https://one-shot-ship-api.onrender.com';
const RUN_BACKSTOP_MS = 60_000;
const TEST_TIMEOUT_MS = 90_000;
const FAKE_KEY = 'fake-test-key-not-real';

let fixtureRoot = '';
let binDir = '';
let pluginRoot = '';

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-suburl-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(pluginRoot);
  fs.symlinkSync(path.resolve(HOOKS_SOURCE), path.join(pluginRoot, 'hooks'));
  writeWarmStub(
    path.join(binDir, 'curl'),
    'printf "%s\\n" "$*" >> "$CURL_CALLS"\ncat >> "$CURL_CALLS.stdin"\nprintf \'{"status":"active"}\'\nexit 0\n',
  );
  writeWarmStub(path.join(binDir, 'node'), 'printf "%s\\n" "$*" >> "$NODE_CALLS"\nexit 0\n');
  for (const name of ['claude', 'say', 'afplay']) writeWarmStub(path.join(binDir, name), 'exit 0\n');
}, WARMUP_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

let caseRoot = '';
let homeDir = '';
let projectDir = '';
let curlCalls = '';

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-suburl-case-'));
  homeDir = path.join(caseRoot, 'home');
  projectDir = path.join(caseRoot, 'project');
  curlCalls = path.join(caseRoot, 'curl-calls');
  fs.mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

interface HookRun {
  status: number | null;
  output: string;
  calls: string[];
  stdin: string;
  nodeCalls: string[];
}

function runHook(
  home: string,
  project: string,
  calls: string,
  config: Record<string, string>,
  backstopMs: number,
  configDir?: string,
  extraEnv: Record<string, string> = {},
): HookRun {
  fs.mkdirSync(path.join(home, '.oss'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, '.oss'), 0o700);
  fs.writeFileSync(path.join(home, '.oss/config.json'), JSON.stringify(config));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    OSS_SKIP_WATCHER: '1',
    CURL_CALLS: calls,
    NODE_CALLS: `${calls}.node`,
  });
  if (configDir) env.OSS_CONFIG_DIR = configDir;
  Object.assign(env, extraEnv);
  const result = spawnSync('bash', [path.join(pluginRoot, 'hooks/oss-session-start.sh')], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    timeout: backstopMs,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`session start did not finish (hang backstop): ${result.error.message}`);
  const recorded = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  const stdin = fs.existsSync(`${calls}.stdin`) ? fs.readFileSync(`${calls}.stdin`, 'utf8') : '';
  const nodeCalls = fs.existsSync(`${calls}.node`) ? fs.readFileSync(`${calls}.node`, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls: recorded, stdin, nodeCalls };
}

function startSession(config: Record<string, string>, configDir?: string, extraEnv: Record<string, string> = {}): HookRun {
  return runHook(homeDir, projectDir, curlCalls, config, RUN_BACKSTOP_MS, configDir, extraEnv);
}

const ALLOW_LOOPBACK = { OSS_ALLOW_HTTP_LOOPBACK: '1' };
const switchLines = (output: string) => output.split('\n').filter((l) => l.includes('OSS_ALLOW_HTTP_LOOPBACK'));

const subscriptionCalls = (calls: string[]) => calls.filter((c) => c.includes('/api/v1/subscription/status'));

describe('oss-session-start.sh: subscription check URL', () => {
  it(
    'sends the subscription request to the configured apiUrl, and nothing to the default host',
    () => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'http://127.0.0.1:9' }, undefined, ALLOW_LOOPBACK);

      expect(run.status, run.output).toBe(0);
      expect(switchLines(run.output), run.output).toEqual([]);
      const sub = subscriptionCalls(run.calls);
      expect(sub, `all curl calls:\n${run.calls.join('\n')}`).toHaveLength(1);
      expect(sub[0]).toContain('http://127.0.0.1:9/api/v1/subscription/status');
      // Every call in the run is accounted for: none goes to the default host.
      expect(run.calls.filter((c) => c.includes('onrender.com')), `all curl calls:\n${run.calls.join('\n')}`).toEqual([]);
      expect(run.calls.join('\n')).not.toContain(FAKE_KEY);
      expect(run.output).toContain('OSS: Ready (active)');
      // The sandbox, not the repo, is the plugin root: no watcher CLI ran.
      expect(run.nodeCalls, `node calls:\n${run.nodeCalls.join('\n')}`).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends the subscription request to the default host when no apiUrl is set',
    () => {
      const run = startSession({ apiKey: FAKE_KEY });

      expect(run.status, run.output).toBe(0);
      expect(switchLines(run.output), run.output).toEqual([]);
      const sub = subscriptionCalls(run.calls);
      expect(sub, `all curl calls:\n${run.calls.join('\n')}`).toHaveLength(1);
      expect(sub[0]).toContain(`${DEFAULT_HOST}/api/v1/subscription/status`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'makes no subscription request when apiUrl is invalid, and still starts the session',
    () => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'http://evil.example' });

      expect(run.status, run.output).toBe(0);
      expect(subscriptionCalls(run.calls), `all curl calls:\n${run.calls.join('\n')}`).toEqual([]);
      expect(run.calls.filter((c) => c.includes('evil.example') || c.includes('onrender.com'))).toEqual([]);
      expect(run.output).toContain('OSS: Ready - IRON LAWS active');
      // Refused for its host, not for plain http: the switch would not help, so it is not named.
      expect(switchLines(run.output), run.output).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'takes the key and its URL from OSS_CONFIG_DIR when set, never the HOME config key',
    () => {
      const keyHome = 'fake-key-home-KA';
      const keyDir = 'fake-key-configdir-KB';
      const configDir = path.join(caseRoot, 'config-b');
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: keyDir, apiUrl: 'http://127.0.0.1:9' }));

      const run = startSession({ apiKey: keyHome }, configDir, ALLOW_LOOPBACK);

      expect(run.status, run.output).toBe(0);
      const sub = subscriptionCalls(run.calls);
      expect(sub, `all curl calls:\n${run.calls.join('\n')}`).toHaveLength(1);
      expect(sub[0]).toContain('http://127.0.0.1:9/api/v1/subscription/status');
      expect(run.stdin, 'curl --config stdin').toContain(`Bearer ${keyDir}`);
      expect(run.stdin, 'curl --config stdin').not.toContain(keyHome);
      expect(run.calls.filter((c) => c.includes('onrender.com'))).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'takes the key and its URL from the HOME config when OSS_CONFIG_DIR is unset',
    () => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'http://127.0.0.1:9' }, undefined, ALLOW_LOOPBACK);

      const sub = subscriptionCalls(run.calls);
      expect(sub, `all curl calls:\n${run.calls.join('\n')}`).toHaveLength(1);
      expect(sub[0]).toContain('http://127.0.0.1:9/api/v1/subscription/status');
      expect(run.stdin, 'curl --config stdin').toContain(`Bearer ${FAKE_KEY}`);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['the subscription check on', {}],
    ['OSS_SKIP_HEALTH_CHECK=1', { OSS_SKIP_HEALTH_CHECK: '1' }],
  ])(
    'refuses a loopback http apiUrl without OSS_ALLOW_HTTP_LOOPBACK=1: no request, one line naming the switch (%s)',
    (_label, extraEnv) => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'http://127.0.0.1:9' }, undefined, extraEnv);

      expect(run.status, run.output).toBe(0);
      expect(run.calls.filter((c) => c.includes('127.0.0.1')), `all curl calls:\n${run.calls.join('\n')}`).toEqual([]);
      expect(subscriptionCalls(run.calls)).toEqual([]);
      const lines = switchLines(run.output);
      expect(lines, run.output).toHaveLength(1);
      expect(lines[0]).toMatch(/^OSS: .*plain http.*set OSS_ALLOW_HTTP_LOOPBACK=1/);
      expect(run.output).not.toContain(FAKE_KEY);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'names no switch when apiUrl is https',
    () => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'https://api.example.com' });

      expect(run.status, run.output).toBe(0);
      expect(switchLines(run.output), run.output).toEqual([]);
      expect(subscriptionCalls(run.calls)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
