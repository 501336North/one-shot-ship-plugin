/**
 * @behavior Starting an /oss command updates the workflow state (the status line) even when the
 *   workflow logger cannot be found anywhere: not next to the hook, and not in the plugin cache.
 * @business-rule A missing optional logger must never stop the status line from tracking the
 *   command that just started.
 * @boundary hooks/oss-notify.sh --workflow <cmd> start, run as Claude Code runs it (piped stdio).
 *
 * Hermetic (same harness as oss-notify-analytics-detach.test.ts):
 * - the sandbox plugin root holds the real oss-notify.sh and what it sources, but NO hooks/oss-log.sh.
 * - two sandbox HOMEs, made once: one with no .claude/plugins/cache at all, one whose plugin cache
 *   holds a no-op oss-log.sh.
 * - a sandbox bin/ first on PATH whose `node` records its argv and whose `curl` is a no-op.
 * - stubs are created and executed once in beforeAll (OSS_STUB_WARMUP=1), never inside a test.
 * - the time limit is only a hang backstop.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_HOOKS = path.join(__dirname, '../../../hooks');

const CLOSE_BACKSTOP_MS = 15_000;
const TEST_TIMEOUT_MS = 40_000;
const WARMUP_TIMEOUT_MS = 180_000;

const WARMUP_GUARD = '[ -n "${OSS_STUB_WARMUP:-}" ] && exit 0';

let fixtureRoot: string;
let binDir: string;
let pluginRoot: string;
let homeWithoutCache: string;
let homeWithCache: string;

function writeStub(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/bash\n${WARMUP_GUARD}\n${body}\n`, { mode: 0o755 });
}

function warm(file: string): void {
  execFileSync(file, [], { env: { ...process.env, OSS_STUB_WARMUP: '1' }, stdio: 'ignore' });
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notify-log-fallback-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  homeWithoutCache = path.join(fixtureRoot, 'home-without-cache');
  homeWithCache = path.join(fixtureRoot, 'home-with-cache');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(homeWithoutCache, '.oss'), { recursive: true });
  fs.mkdirSync(path.join(homeWithCache, '.oss'), { recursive: true });

  // node: wf_state calls `node "$WORKFLOW_STATE_CLI" <command> ...`; record each call on one line.
  writeStub(
    path.join(binDir, 'node'),
    ['[ -n "${STUB_STATE:-}" ] || exit 0', 'printf "%s\\n" "$*" >> "$STUB_STATE/node-calls"', 'exit 0'].join('\n'),
  );
  writeStub(path.join(binDir, 'curl'), 'exit 0');

  for (const name of ['oss-notify.sh', 'oss-api-curl.sh', 'oss-safe-path.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  // Deliberately NO plugin/hooks/oss-log.sh.
  const wfCli = path.join(pluginRoot, 'watcher/dist/cli/update-workflow-state.js');
  fs.mkdirSync(path.dirname(wfCli), { recursive: true });
  fs.writeFileSync(wfCli, '// stub path; `node` on PATH is a recording stub\n');

  const cachedLog = path.join(homeWithCache, '.claude/plugins/cache/one-shot-ship-plugin/x/hooks/oss-log.sh');
  writeStub(cachedLog, 'exit 0');

  for (const stub of [path.join(binDir, 'node'), path.join(binDir, 'curl'), cachedLog]) warm(stub);
}, WARMUP_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

let caseRoot: string;
let stateDir: string;

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notify-log-fallback-case-'));
  stateDir = path.join(caseRoot, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(caseRoot, 'project'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** Runs `oss-notify.sh --workflow build start '{}'` and resolves with its exit code (null on backstop). */
async function startBuild(home: string): Promise<number | null> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_STATE: stateDir,
  });
  const child = spawn('bash', [path.join(pluginRoot, 'hooks/oss-notify.sh'), '--workflow', 'build', 'start', '{}'], {
    cwd: path.join(caseRoot, 'project'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  const closed = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  const result = await Promise.race([closed, delay(CLOSE_BACKSTOP_MS).then(() => 'backstop' as const)]);
  if (result === 'backstop') {
    child.kill('SIGKILL');
    throw new Error(`oss-notify.sh did not close within ${CLOSE_BACKSTOP_MS / 1000} s`);
  }
  return result;
}

function nodeCalls(): string[] {
  const file = path.join(stateDir, 'node-calls');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [];
}

function recordedActiveStep(): boolean {
  return nodeCalls().some((call) => /\bsetActiveStep build\b/.test(call));
}

describe('oss-notify.sh --workflow build start: workflow state without a local oss-log.sh', () => {
  it(
    'should still update workflow state when oss-log.sh and the plugin cache are both missing',
    async () => {
      const code = await startBuild(homeWithoutCache);

      expect(
        recordedActiveStep(),
        `no "setActiveStep build" state call (exit ${code}); node calls: ${JSON.stringify(nodeCalls())}`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should still update workflow state when the plugin cache has an oss-log.sh',
    async () => {
      const code = await startBuild(homeWithCache);

      expect(
        recordedActiveStep(),
        `no "setActiveStep build" state call (exit ${code}); node calls: ${JSON.stringify(nodeCalls())}`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
