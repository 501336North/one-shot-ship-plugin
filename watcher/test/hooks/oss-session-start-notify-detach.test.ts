/**
 * @behavior Claude Code finishes starting a session without waiting for the status-line
 *   notification, whether the session is fresh or restores a saved context.
 * @business-rule The session notification is fire-and-forget: a slow notify call must never hold
 *   Claude Code's startup, in either branch (fresh_start or context_restored).
 * @boundary hooks/oss-session-start.sh, run as Claude Code runs it (piped stdio, done only when
 *   stdout AND stderr reach EOF).
 *
 * Hermetic and free of wall-clock assertions (same harness as
 * acceptance/hook-background-detach.acceptance.test.ts, "session start"):
 * - per-test HOME and project cwd (mkdtemp); CLAUDE_*, OSS_* and CURL* removed from the env.
 *   OSS_SKIP_HEALTH_CHECK is deliberately NOT set: it disables the notify launch.
 * - a sandbox bin/ first on PATH whose `curl` is a recording stub, so no request leaves the machine.
 * - the hook runs from a sandbox plugin root holding the real oss-session-start.sh and what it
 *   sources, plus an oss-notify.sh stub that records its argv, writes `received` and holds its
 *   inherited stdout until `release` (30 s self-exit backstop).
 * - stubs are created and executed once in beforeAll (writeWarmStub), never inside a test.
 * - time limits are only hang backstops; hitting one is a failure with a message. Session start
 *   does real work before it launches the notify call, so the marker backstop is generous.
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
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-detach-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });

  writeWarmStub(
    path.join(binDir, 'curl'),
    ['[ -n "${STUB_STATE:-}" ] && printf "%s\\n" "$@" >> "$STUB_STATE/curl-argv"', 'exit 0'].join('\n'),
  );

  for (const name of ['oss-session-start.sh', 'oss-api-curl.sh', 'oss-safe-path.sh', 'oss-config.sh', 'oss-settings-cleanup.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  writeWarmStub(
    path.join(pluginRoot, 'hooks/oss-notify.sh'),
    ['printf "%s\\n" "$*" >> "$STUB_STATE/notify-argv"', ': > "$STUB_STATE/notify-received"', HOLD_UNTIL_RELEASE, 'exit 0'].join(
      '\n',
    ),
  );
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
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-session-start-detach-case-'));
  homeDir = path.join(caseRoot, 'home');
  projectDir = path.join(caseRoot, 'project');
  stateDir = path.join(caseRoot, 'state');
  for (const dir of [homeDir, projectDir, stateDir]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.oss'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(homeDir, '.oss/config.json'),
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

async function fileAppears(file: string): Promise<boolean> {
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (fs.existsSync(file)) return true;
    await delay(50);
  }
  return fs.existsSync(file);
}

function readIfExists(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function saveSessionContext(): void {
  fs.mkdirSync(path.join(projectDir, '.oss'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.oss/session-context.md'),
    '# Session Context\n\n**Branch:** feat/x\n\n_Saved: 2026-01-01 10:00:00_\n',
  );
}

function startSession(): HookRun {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: homeDir,
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_STATE: stateDir,
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

const cases: Array<{ branch: string; event: string; withSavedContext: boolean }> = [
  { branch: 'fresh start', event: 'fresh_start', withSavedContext: false },
  { branch: 'context restored', event: 'context_restored', withSavedContext: true },
];

describe('oss-session-start.sh: background notify call', () => {
  describe('should finish starting while the notify call is still running', () => {
    for (const { branch, event, withSavedContext } of cases) {
      it(
        branch,
        async () => {
          if (withSavedContext) saveSessionContext();
          const run = startSession();

          const launched = await fileAppears(path.join(stateDir, 'notify-received'));
          expect(launched, `session start never launched oss-notify.sh; output:\n${run.output()}`).toBe(true);

          await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
          expect(
            run.isClosed() && !fs.existsSync(path.join(stateDir, 'release')),
            `oss-session-start.sh (${branch}) kept its stdout/stderr open while oss-notify.sh --session ${event} ` +
              `was running (not closed ${CLOSE_BACKSTOP_MS / 1000} s after the launch; Claude Code would still be waiting)`,
          ).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    }
  });

  describe('should still launch the notify call', () => {
    for (const { branch, event, withSavedContext } of cases) {
      it(
        branch,
        async () => {
          if (withSavedContext) saveSessionContext();
          const run = startSession();

          expect(
            await fileAppears(path.join(stateDir, 'notify-received')),
            `session start never launched oss-notify.sh; output:\n${run.output()}`,
          ).toBe(true);
          expect(readIfExists(path.join(stateDir, 'notify-argv'))).toContain(`--session ${event}`);
        },
        TEST_TIMEOUT_MS,
      );
    }
  });
});
