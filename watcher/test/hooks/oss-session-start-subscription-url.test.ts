/**
 * @behavior When a session starts, the subscription check asks the API the user configured
 *   (apiUrl in ~/.oss/config.json), or the default API when none is set. When apiUrl is invalid,
 *   no subscription request is made, and session start still finishes normally.
 * @business-rule The API key goes only to the configured API: the same URL rule (oss_api_url) that
 *   every other keyed call uses. No call during session start may send it to the default host when
 *   the user set an apiUrl.
 * @boundary hooks/oss-session-start.sh, run as Claude Code runs it.
 *
 * Hermetic:
 * - per-test HOME (mkdtemp, .oss at 0700) and project cwd; CLAUDE_*, OSS_* and CURL* are removed from
 *   the child env (that includes CLAUDE_CODE_SESSION_ID, CLAUDE_PROJECT_DIR and OSS_CONFIG_DIR).
 *   OSS_SKIP_WATCHER=1 is set. OSS_SKIP_HEALTH_CHECK stays unset, because the subscription check runs
 *   only when it is not "1"; OSS_RUN_HEALTH_CHECK stays unset, so the opt-in test run does not start.
 * - a sandbox bin/ first on PATH: a recording `curl` (one line of argv per call, in a per-test file,
 *   prints {"status":"active"}) and no-op `claude`, `say` and `afplay`. Stubs are warmed once in beforeAll.
 * - the hook runs from a sandbox plugin root: a copy of hooks/ (no watcher/dist, so no node CLI runs).
 *   OSS_TEST_HOOKS_DIR may point the copy at another hooks dir (used to run mutants).
 * - the copied hooks are new files, so beforeAll runs the whole hook once (warm-up session, own HOME):
 *   the macOS first-exec scan of every script it execs happens there, not inside a test. Without it,
 *   parallel runs measured a 40-60 s first session start.
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
  fs.cpSync(HOOKS_SOURCE, path.join(pluginRoot, 'hooks'), {
    recursive: true,
    filter: (src) => path.basename(src) !== '__tests__',
  });
  writeWarmStub(
    path.join(binDir, 'curl'),
    'printf "%s\\n" "$*" >> "$CURL_CALLS"\nprintf \'{"status":"active"}\'\nexit 0\n',
  );
  for (const name of ['claude', 'say', 'afplay']) writeWarmStub(path.join(binDir, name), 'exit 0\n');

  const warm = path.join(fixtureRoot, 'warm-up');
  fs.mkdirSync(path.join(warm, 'project'), { recursive: true });
  runHook(path.join(warm, 'home'), path.join(warm, 'project'), path.join(warm, 'curl-calls'),
    { apiKey: FAKE_KEY, apiUrl: 'http://127.0.0.1:9' }, WARMUP_TIMEOUT_MS - 30_000);
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
}

function runHook(home: string, project: string, calls: string, config: Record<string, string>, backstopMs: number): HookRun {
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
  });
  const result = spawnSync('bash', [path.join(pluginRoot, 'hooks/oss-session-start.sh')], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    timeout: backstopMs,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`session start did not finish (hang backstop): ${result.error.message}`);
  const recorded = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls: recorded };
}

function startSession(config: Record<string, string>): HookRun {
  return runHook(homeDir, projectDir, curlCalls, config, RUN_BACKSTOP_MS);
}

const subscriptionCalls = (calls: string[]) => calls.filter((c) => c.includes('/api/v1/subscription/status'));

describe('oss-session-start.sh: subscription check URL', () => {
  it(
    'sends the subscription request to the configured apiUrl, and nothing to the default host',
    () => {
      const run = startSession({ apiKey: FAKE_KEY, apiUrl: 'http://127.0.0.1:9' });

      expect(run.status, run.output).toBe(0);
      const sub = subscriptionCalls(run.calls);
      expect(sub, `all curl calls:\n${run.calls.join('\n')}`).toHaveLength(1);
      expect(sub[0]).toContain('http://127.0.0.1:9/api/v1/subscription/status');
      // Every call in the run is accounted for: none goes to the default host.
      expect(run.calls.filter((c) => c.includes('onrender.com')), `all curl calls:\n${run.calls.join('\n')}`).toEqual([]);
      expect(run.calls.join('\n')).not.toContain(FAKE_KEY);
      expect(run.output).toContain('OSS: Ready (active)');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends the subscription request to the default host when no apiUrl is set',
    () => {
      const run = startSession({ apiKey: FAKE_KEY });

      expect(run.status, run.output).toBe(0);
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
    },
    TEST_TIMEOUT_MS,
  );
});
