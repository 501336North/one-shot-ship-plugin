/**
 * @behavior Claude Code finishes starting a session while the opt-in health check
 *   (OSS_RUN_HEALTH_CHECK=1) is still running, and the health check's summary still reaches
 *   the user, in ~/.oss/logs/current-session/health-check.log.
 * @business-rule The health check runs "in background to not block session start": a long test run
 *   must never hold Claude Code's startup. Its summary is written to its log (DECISIONS D3).
 * @boundary hooks/oss-session-start.sh, run as Claude Code runs it (piped stdio, done only when
 *   stdout AND stderr reach EOF).
 *
 * Hermetic and free of wall-clock assertions (same harness as oss-session-start-notify-detach.test.ts):
 * - per-test HOME and project cwd (mkdtemp); CLAUDE_*, OSS_* and CURL* removed from the env.
 *   The project holds a package.json, which the health check requires.
 * - OSS_SKIP_HEALTH_CHECK=1 is set: it skips the notify launch, logging, the version check and the
 *   subscription request, none of which this file is about. It does not gate the opt-in health check.
 * - a sandbox bin/ first on PATH holding a recording `curl` stub (no request leaves the machine) and a
 *   `node` stub. When `node` is called with the health-check CLI, it writes `received`, holds its
 *   inherited stdout until `release` (30 s self-exit backstop), then exits with $STUB_HEALTH_EXIT.
 *   Any other `node` call exits 0.
 * - the hook runs from a sandbox plugin root holding the real oss-session-start.sh and what it
 *   sources, plus a dummy watcher/dist/cli/health-check.js so the hook finds the CLI.
 * - stubs are created and executed once in beforeAll (writeWarmStub), never inside a test.
 * - time limits are only hang backstops; hitting one is a failure with a message.
 * - the time-bound case sets OSS_HEALTH_CHECK_TIMEOUT=1 and never releases the stub: only the bound can
 *   end it (the stub's own 30 s backstop exits 0, which would log "passed", not the error).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

const REPO_HOOKS = path.join(__dirname, '../../../hooks');

const CLOSE_BACKSTOP_MS = 15_000;
const MARKER_BACKSTOP_MS = 60_000;
const TEST_TIMEOUT_MS = 100_000;

const HOLD_UNTIL_RELEASE =
  'i=0; while [ ! -e "$STUB_STATE/release" ] && [ "$i" -lt 600 ]; do /bin/sleep 0.05; i=$((i+1)); done';

let fixtureRoot: string;
let binDir: string;
let pluginRoot: string;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-health-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });

  writeWarmStub(
    path.join(binDir, 'curl'),
    ['[ -n "${STUB_STATE:-}" ] && printf "%s\\n" "$@" >> "$STUB_STATE/curl-argv"', 'exit 0'].join('\n'),
  );
  writeWarmStub(
    path.join(binDir, 'node'),
    [
      'case "${1:-}" in */watcher/dist/cli/health-check.js) ;; *) exit 0 ;; esac',
      ': > "$STUB_STATE/health-received"',
      HOLD_UNTIL_RELEASE,
      'exit "${STUB_HEALTH_EXIT:-0}"',
    ].join('\n'),
  );

  for (const name of ['oss-session-start.sh', 'oss-api-curl.sh', 'oss-safe-path.sh', 'oss-config.sh', 'oss-settings-cleanup.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  const healthCli = path.join(pluginRoot, 'watcher/dist/cli/health-check.js');
  fs.mkdirSync(path.dirname(healthCli), { recursive: true });
  fs.writeFileSync(healthCli, '// dummy: the PATH node stub stands in for the health check\n');
}, WARMUP_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

interface HookRun {
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
  output: () => string;
}

let caseRoot: string;
let homeDir: string;
let projectDir: string;
let stateDir: string;
let runs: HookRun[];

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-health-case-'));
  homeDir = path.join(caseRoot, 'home');
  projectDir = path.join(caseRoot, 'project');
  stateDir = path.join(caseRoot, 'state');
  for (const dir of [homeDir, projectDir, stateDir]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.oss'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(homeDir, '.oss/config.json'),
    JSON.stringify({ apiKey: 'fake-test-key-not-real', apiUrl: 'http://127.0.0.1:9' }),
  );
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"health-check-sandbox"}\n');
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

async function fileAppears(file: string): Promise<boolean> {
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (fs.existsSync(file)) return true;
    await delay(50);
  }
  return fs.existsSync(file);
}

async function fileContains(file: string, text: string): Promise<boolean> {
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (readIfExists(file).includes(text)) return true;
    await delay(50);
  }
  return readIfExists(file).includes(text);
}

function readIfExists(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function startSession(healthExit: number, extraEnv: Record<string, string> = {}): HookRun {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: homeDir,
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    OSS_RUN_HEALTH_CHECK: '1',
    OSS_SKIP_HEALTH_CHECK: '1',
    STUB_STATE: stateDir,
    STUB_HEALTH_EXIT: String(healthExit),
    ...extraEnv,
  });
  const child = spawn('bash', [path.join(pluginRoot, 'hooks/oss-session-start.sh')], {
    cwd: projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let closed = false;
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const closedPromise = new Promise<void>((resolve) =>
    child.on('close', () => {
      closed = true;
      resolve();
    }),
  );
  const run: HookRun = { child, closed: closedPromise, isClosed: () => closed, output: () => out };
  runs.push(run);
  return run;
}

describe('oss-session-start.sh: opt-in health check', () => {
  it(
    'should finish starting while the opt-in health check is still running',
    async () => {
      const run = startSession(0);

      const launched = await fileAppears(path.join(stateDir, 'health-received'));
      expect(launched, `session start never launched the health check; output:\n${run.output()}`).toBe(true);

      await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
      expect(
        run.isClosed() && !fs.existsSync(path.join(stateDir, 'release')),
        `oss-session-start.sh kept its stdout/stderr open while the opt-in health check was running ` +
          `(not closed ${CLOSE_BACKSTOP_MS / 1000} s after the launch; Claude Code would still be waiting)`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should end a health check that outlives its time bound and log the error',
    async () => {
      const run = startSession(0, { OSS_HEALTH_CHECK_TIMEOUT: '1' });
      const healthLog = path.join(homeDir, '.oss/logs/current-session/health-check.log');

      const launched = await fileAppears(path.join(stateDir, 'health-received'));
      expect(launched, `session start never launched the health check; output:\n${run.output()}`).toBe(true);

      expect(
        await fileContains(healthLog, 'Health check error'),
        `a hung health check was never ended (no error summary while the stub was held); log:\n` +
          `${readIfExists(healthLog)}\nhook output:\n${run.output()}`,
      ).toBe(true);
      expect(readIfExists(healthLog)).not.toContain('Health check passed');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should write the health check summary to its log',
    async () => {
      const run = startSession(0);
      const healthLog = path.join(homeDir, '.oss/logs/current-session/health-check.log');

      const launched = await fileAppears(path.join(stateDir, 'health-received'));
      expect(launched, `session start never launched the health check; output:\n${run.output()}`).toBe(true);
      fs.writeFileSync(path.join(stateDir, 'release'), '');

      expect(
        await fileContains(healthLog, 'Health check passed'),
        `health-check.log never got the summary; log:\n${readIfExists(healthLog)}\nhook output:\n${run.output()}`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
