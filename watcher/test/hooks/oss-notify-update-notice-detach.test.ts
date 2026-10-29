/**
 * @behavior Opening or restoring a Claude Code session hands control back at once, even when a
 *   plugin update notice is pending; the notice still appears on the status line a little later.
 * @business-rule The update notice is deliberately delayed (so the session notification can expire
 *   first), and that delay must never hold the session event: it runs fully in the background.
 * @boundary hooks/oss-notify.sh --session fresh_start|context_restored, run as Claude Code runs it
 *   (piped stdio, done only when stdout AND stderr reach EOF).
 *
 * Hermetic and free of wall-clock assertions (same harness as
 * acceptance/hook-background-detach.acceptance.test.ts):
 * - per-test HOME and cwd (mkdtemp); CLAUDE_*, OSS_* and CURL* removed from the env; a sandbox
 *   bin/ first on PATH whose `node` and `sleep` are stubs.
 * - the hook runs from a sandbox plugin root holding the real oss-notify.sh and what it sources, a
 *   no-op oss-log.sh, a dummy workflow-state CLI path and a check-updates.sh that prints a notice.
 * - `node` records every workflow-state CLI call; `sleep` turns the notice delay (any sleep of
 *   10 s or more) into "write delay-received, wait for release" and passes shorter sleeps on.
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
const TEST_TIMEOUT_MS = 60_000;

const NOTICE = 'OSS update available: 9.9.9';
const NOTICE_CALL = `setNotification ${NOTICE} 30`;

// /bin/sleep explicitly: the sandbox PATH carries the `sleep` stub itself.
const HOLD_UNTIL_RELEASE =
  'i=0; while [ ! -e "$STUB_STATE/release" ] && [ "$i" -lt 600 ]; do /bin/sleep 0.05; i=$((i+1)); done';

let fixtureRoot: string;
let binDir: string;
let pluginRoot: string;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-update-notice-detach-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });

  // node: wf_state / wf_state_timeout call `node "$WORKFLOW_STATE_CLI" <command> ...`; record each call.
  writeWarmStub(
    path.join(binDir, 'node'),
    ['[ -n "${STUB_STATE:-}" ] && printf "%s\\n" "$*" >> "$STUB_STATE/node-calls"', 'exit 0'].join('\n'),
  );
  // sleep: the notice delay (10 s or more) waits for `release` instead of the clock.
  writeWarmStub(
    path.join(binDir, 'sleep'),
    [
      'n="${1:-0}"; n="${n%%.*}"',
      'if [ -z "${STUB_STATE:-}" ] || ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 10 ]; then exec /bin/sleep "$@"; fi',
      ': > "$STUB_STATE/delay-received"',
      HOLD_UNTIL_RELEASE,
      'exit 0',
    ].join('\n'),
  );

  for (const name of ['oss-notify.sh', 'oss-api-curl.sh', 'oss-safe-path.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  // Without oss-log.sh next to it, oss-notify.sh's plugin-cache fallback exits the hook early.
  writeWarmStub(path.join(pluginRoot, 'hooks/oss-log.sh'), 'exit 0');
  writeWarmStub(path.join(pluginRoot, 'hooks/check-updates.sh'), `echo "${NOTICE}"`);
  const wfCli = path.join(pluginRoot, 'watcher/dist/cli/update-workflow-state.js');
  fs.mkdirSync(path.dirname(wfCli), { recursive: true });
  fs.writeFileSync(wfCli, '// stub path; `node` on PATH is the recording stub\n');
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
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-update-notice-detach-case-'));
  stateDir = path.join(caseRoot, 'state');
  for (const dir of ['home/.oss', 'project', 'state']) fs.mkdirSync(path.join(caseRoot, dir), { recursive: true });
  runs = [];
});

afterEach(async () => {
  fs.writeFileSync(path.join(stateDir, 'release'), '');
  await Promise.all(runs.map((run) => Promise.race([run.closed, delay(MARKER_BACKSTOP_MS)])));
  // Let the detached notice subshell finish its last call before the sandbox goes away.
  await waitFor(() => nodeCalls().includes(NOTICE_CALL) || !fs.existsSync(path.join(stateDir, 'delay-received')));
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

async function waitFor(condition: () => boolean): Promise<boolean> {
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (condition()) return true;
    await delay(50);
  }
  return condition();
}

function nodeCalls(): string {
  const file = path.join(stateDir, 'node-calls');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function startSessionEvent(event: string): HookRun {
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
  });
  const child = spawn('bash', [path.join(pluginRoot, 'hooks/oss-notify.sh'), '--session', event, '{"project":"p"}'], {
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

describe('oss-notify.sh --session <event>: pending update notice', () => {
  it(
    'should close its output before the update notice is posted',
    async () => {
      const run = startSessionEvent('fresh_start');

      const delayReached = await waitFor(() => fs.existsSync(path.join(stateDir, 'delay-received')));
      expect(delayReached, `the update-notice delay was never reached; node calls:\n${nodeCalls()}`).toBe(true);

      await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
      expect(
        run.isClosed() && !nodeCalls().includes(NOTICE_CALL),
        run.isClosed()
          ? `the update notice was posted before oss-notify.sh --session closed its output`
          : `oss-notify.sh --session fresh_start kept its stdout/stderr open while the update notice was pending ` +
              `(not closed ${CLOSE_BACKSTOP_MS / 1000} s after the notice delay started)`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should still post the update notice',
    async () => {
      startSessionEvent('context_restored');

      expect(
        await waitFor(() => fs.existsSync(path.join(stateDir, 'delay-received'))),
        `the update-notice delay was never reached; node calls:\n${nodeCalls()}`,
      ).toBe(true);
      fs.writeFileSync(path.join(stateDir, 'release'), '');

      expect(
        await waitFor(() => nodeCalls().includes(NOTICE_CALL)),
        `the update notice was never posted; node calls:\n${nodeCalls()}`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
