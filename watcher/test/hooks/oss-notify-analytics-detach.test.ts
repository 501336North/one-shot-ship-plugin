/**
 * @behavior Starting any /oss command hands control back to Claude Code at once, while the usage
 *   analytics request it fires is still in flight, and that request cannot run forever.
 * @business-rule Usage analytics is fire-and-forget: a slow or dead analytics API must never hold
 *   the start of a command, and a background request must give up after a bounded time.
 * @boundary hooks/oss-notify.sh --workflow <cmd> start, run as Claude Code runs it (piped stdio,
 *   done only when stdout AND stderr reach EOF).
 *
 * Hermetic and free of wall-clock assertions (same harness as
 * acceptance/hook-background-detach.acceptance.test.ts):
 * - per-test HOME (mkdtemp) with a FAKE apiKey and apiUrl http://127.0.0.1:9; CLAUDE_*, OSS_* and
 *   CURL* removed from the env; a sandbox bin/ first on PATH whose `curl` and `node` are stubs.
 * - the hook runs from a sandbox plugin root holding the real oss-notify.sh and what it sources.
 * - the curl stub records its argv, writes `received`, and (CURL_STUB_HOLD=1) waits for `release`.
 * - stubs are created and executed once in beforeAll (writeWarmStub), never inside a test.
 * - time limits are only hang backstops; hitting one is a failure with a message.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

const REPO_HOOKS = path.join(__dirname, '../../../hooks');

const CLOSE_BACKSTOP_MS = 15_000;
const MARKER_BACKSTOP_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;

const HOLD_UNTIL_RELEASE =
  'i=0; while [ ! -e "$STUB_STATE/release" ] && [ "$i" -lt 600 ]; do sleep 0.05; i=$((i+1)); done';

let fixtureRoot: string;
let binDir: string;
let pluginRoot: string;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-analytics-detach-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });

  // curl: oss_api_curl runs plain `curl` from PATH (the key arrives on stdin via --config -, not argv).
  writeWarmStub(
    path.join(binDir, 'curl'),
    [
      '[ -n "${STUB_STATE:-}" ] || exit 0',
      'printf "%s\\n" "$@" >> "$STUB_STATE/curl-argv"',
      ': > "$STUB_STATE/curl-received"',
      `if [ "\${CURL_STUB_HOLD:-}" = "1" ]; then ${HOLD_UNTIL_RELEASE}; fi`,
      'exit 0',
    ].join('\n'),
  );
  // node: wf_state calls `node "$WORKFLOW_STATE_CLI" ...`; a no-op keeps the real CLI out.
  writeWarmStub(path.join(binDir, 'node'), 'exit 0');

  for (const name of ['oss-notify.sh', 'oss-api-curl.sh', 'oss-safe-path.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  // Without oss-log.sh next to it, oss-notify.sh's plugin-cache fallback exits the hook early.
  writeWarmStub(path.join(pluginRoot, 'hooks/oss-log.sh'), 'exit 0');
  const wfCli = path.join(pluginRoot, 'watcher/dist/cli/update-workflow-state.js');
  fs.mkdirSync(path.dirname(wfCli), { recursive: true });
  fs.writeFileSync(wfCli, '// stub path; `node` on PATH is a no-op stub\n');
}, WARMUP_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

interface HookRun {
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
}

let caseRoot: string;
let stateDir: string;
let runs: HookRun[];

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-analytics-detach-case-'));
  stateDir = path.join(caseRoot, 'state');
  for (const dir of ['home/.oss', 'project', 'state']) fs.mkdirSync(path.join(caseRoot, dir), { recursive: true });
  fs.writeFileSync(
    path.join(caseRoot, 'home/.oss/config.json'),
    JSON.stringify({ apiKey: 'fake-test-key-not-real', apiUrl: 'http://127.0.0.1:9' }),
  );
  runs = [];
});

afterEach(async () => {
  fs.writeFileSync(path.join(stateDir, 'release'), '');
  await Promise.all(runs.map((run) => Promise.race([run.closed, delay(MARKER_BACKSTOP_MS)])));
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function startWorkflow(command: string, extraEnv: Record<string, string> = {}): HookRun {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: path.join(caseRoot, 'home'),
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_STATE: stateDir,
    ...extraEnv,
  });
  const child = spawn('bash', [path.join(pluginRoot, 'hooks/oss-notify.sh'), '--workflow', command, 'start', '{}'], {
    cwd: path.join(caseRoot, 'project'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  let closed = false;
  const closedPromise = new Promise<void>((resolve) =>
    child.on('close', () => {
      closed = true;
      resolve();
    }),
  );
  const run: HookRun = { child, closed: closedPromise, isClosed: () => closed };
  runs.push(run);
  return run;
}

async function analyticsRequestReceived(): Promise<boolean> {
  const marker = path.join(stateDir, 'curl-received');
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (fs.existsSync(marker)) return true;
    await delay(50);
  }
  return fs.existsSync(marker);
}

function curlArgs(): string[] {
  const file = path.join(stateDir, 'curl-argv');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [];
}

/** The value of curl's -m / --max-time option (separate or joined forms), or null when absent. */
function maxTimeSeconds(args: string[]): number | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-m' || arg === '--max-time') && i + 1 < args.length) return Number(args[i + 1]);
    const joined = /^(?:-m|--max-time=)(\d+(?:\.\d+)?)$/.exec(arg);
    if (joined) return Number(joined[1]);
  }
  return null;
}

describe('oss-notify.sh --workflow <cmd> start: analytics request', () => {
  it(
    'should close its output before the analytics request finishes',
    async () => {
      const run = startWorkflow('build', { CURL_STUB_HOLD: '1' });

      expect(await analyticsRequestReceived(), 'the analytics request was never made').toBe(true);

      await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
      expect(
        run.isClosed() && !fs.existsSync(path.join(stateDir, 'release')),
        `oss-notify.sh kept its stdout/stderr open while the analytics request was in flight ` +
          `(not closed ${CLOSE_BACKSTOP_MS / 1000} s after the request started)`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should give the analytics request a time limit',
    async () => {
      startWorkflow('build');

      expect(await analyticsRequestReceived(), 'the analytics request was never made').toBe(true);
      const limit = maxTimeSeconds(curlArgs());
      expect(limit, `no -m/--max-time in the analytics curl call: ${JSON.stringify(curlArgs())}`).not.toBeNull();
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(10);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should still send the analytics event',
    async () => {
      startWorkflow('plan');

      expect(await analyticsRequestReceived(), 'the analytics request was never made').toBe(true);
      const args = curlArgs();
      expect(args.some((arg) => arg.endsWith('/api/v1/analytics/track'))).toBe(true);
      expect(args.join('\n')).toContain('"command": "plan"');
    },
    TEST_TIMEOUT_MS,
  );
});
