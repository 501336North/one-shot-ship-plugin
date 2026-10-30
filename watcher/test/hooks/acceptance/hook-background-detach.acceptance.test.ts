/**
 * @behavior Hooks hand control back to Claude Code at once, even while their background work
 *   (analytics request, update notice, session notification) is still running.
 * @acceptance-criteria Claude Code waits until a hook's stdout AND stderr reach EOF, not until bash
 *   exits. So a hook's output must close while its background jobs are still in flight.
 * @business-rule A slow network or a pending update notice must never delay session start or the
 *   start of any /oss command.
 * @boundary Shell scripts (hooks/oss-notify.sh, hooks/oss-session-start.sh), run as Claude Code runs them.
 *
 * How these tests stay hermetic and free of wall-clock assertions:
 * - Every hook runs with a per-test HOME (mkdtemp), a cwd inside that sandbox, CLAUDE_* and OSS_*
 *   removed from its env, and a sandbox bin/ first on PATH. ~/.oss/config.json holds a FAKE key and
 *   an apiUrl of http://127.0.0.1:9; `curl` on PATH is a stub, so no request ever leaves the machine.
 * - The hooks run from a sandbox plugin root (CLAUDE_PLUGIN_ROOT), so scripts they run "next to
 *   themselves" (check-updates.sh, oss-notify.sh) are stubs we own.
 * - Slow collaborators are event-driven stubs: they write a `received` marker, then wait for a
 *   `release` file (30 s self-exit backstop). A test asserts that the hook's `close` event
 *   (every stdio pipe at EOF, which is what Claude Code waits for) fires while `release` does not
 *   exist yet. Time limits below are only hang backstops: hitting one is a failure with a message.
 * - Stubs are created once in beforeAll and executed once there (writeWarmStub), so the macOS
 *   first-exec security scan of a new executable never happens inside a test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from '../helpers/warm-stub';

const REPO_HOOKS = path.join(__dirname, '../../../../hooks');

// Hang backstops (not assertions about speed). A fixed hook closes in well under a second.
// The marker backstop is generous: session start does real work before it launches the notify
// call, and a 20 s backstop was once hit under full-suite load.
const CLOSE_BACKSTOP_MS = 15_000;
const MARKER_BACKSTOP_MS = 60_000;
const TEST_TIMEOUT_MS = 100_000;

// Waits for $STUB_STATE/release; self-exits after 30 s so a crashed test never leaks a process.
// Uses /bin/sleep explicitly because the sandbox PATH carries a `sleep` stub (scenario 2).
const HOLD_UNTIL_RELEASE =
  'i=0; while [ ! -e "$STUB_STATE/release" ] && [ "$i" -lt 600 ]; do /bin/sleep 0.05; i=$((i+1)); done';

let fixtureRoot: string;
let binDir: string;
let notifyPluginRoot: string;
let sessionPluginRoot: string;

function copyHook(name: string, pluginRoot: string): void {
  fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
  fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-detach-'));
  binDir = path.join(fixtureRoot, 'bin');

  // curl: the seam oss_api_curl reaches (it runs plain `curl` from PATH). Records argv; when
  // CURL_STUB_HOLD=1 it signals `curl-received` and holds the request open until `release`.
  writeWarmStub(
    path.join(binDir, 'curl'),
    [
      '[ -n "${STUB_STATE:-}" ] || exit 0',
      'printf "%s\\n" "$@" >> "$STUB_STATE/curl-argv"',
      'if [ "${CURL_STUB_HOLD:-}" = "1" ]; then',
      '  : > "$STUB_STATE/curl-received"',
      `  ${HOLD_UNTIL_RELEASE}`,
      'fi',
      'exit 0',
    ].join('\n'),
  );

  // node: wf_state / wf_state_timeout call `node "$WORKFLOW_STATE_CLI" <command> ...` from PATH.
  // Recording that argv is the smallest seam that shows WHEN the update notice is posted
  // (setNotification <notice> 30) without running the real workflow-state CLI.
  writeWarmStub(
    path.join(binDir, 'node'),
    ['[ -n "${STUB_STATE:-}" ] && printf "%s\\n" "$*" >> "$STUB_STATE/node-calls"', 'exit 0'].join('\n'),
  );

  // sleep: oss-notify.sh delays the update notice with a long `sleep` (11 s today) so the session
  // notification can expire first. Any sleep of 10 s or more is that delay: it signals
  // `delay-received` and waits for `release` instead of the clock. Shorter sleeps (timeout timers)
  // are passed to the real /bin/sleep.
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

  // Plugin root for oss-notify.sh: the real hook and the files it sources, a dummy workflow-state
  // CLI path (the hook only checks that it exists; `node` above is the stub), and a
  // check-updates.sh that always has an update notice pending.
  notifyPluginRoot = path.join(fixtureRoot, 'notify-plugin');
  fs.mkdirSync(path.join(notifyPluginRoot, 'hooks'), { recursive: true });
  for (const name of ['oss-notify.sh', 'oss-api-curl.sh', 'oss-safe-path.sh']) copyHook(name, notifyPluginRoot);
  const wfCli = path.join(notifyPluginRoot, 'watcher/dist/cli/update-workflow-state.js');
  fs.mkdirSync(path.dirname(wfCli), { recursive: true });
  fs.writeFileSync(wfCli, '// stub path; `node` on PATH is the recording stub\n');
  writeWarmStub(path.join(notifyPluginRoot, 'hooks/check-updates.sh'), 'echo "OSS update available: 9.9.9"');
  // oss-log.sh: every real install ships it next to oss-notify.sh. Without it, oss-notify.sh falls
  // back to `find ~/.claude/plugins/cache/... | sort | tail` which, under its set -euo pipefail and
  // a sandbox HOME with no plugin cache, exits the hook before it does anything. A no-op stands in.
  writeWarmStub(path.join(notifyPluginRoot, 'hooks/oss-log.sh'), 'exit 0');

  // Plugin root for oss-session-start.sh: the real hook and what it sources or runs with bash,
  // plus an oss-notify.sh stub that holds its inherited stdio until `release`. Everything else
  // session start would run (oss-log.sh, version check, permissions setup, iron-laws sync,
  // workflow-state CLI) is deliberately absent, so it is skipped.
  sessionPluginRoot = path.join(fixtureRoot, 'session-plugin');
  fs.mkdirSync(path.join(sessionPluginRoot, 'hooks'), { recursive: true });
  for (const name of ['oss-session-start.sh', 'oss-api-curl.sh', 'oss-safe-path.sh', 'oss-config.sh', 'oss-settings-cleanup.sh']) {
    copyHook(name, sessionPluginRoot);
  }
  writeWarmStub(
    path.join(sessionPluginRoot, 'hooks/oss-notify.sh'),
    ['printf "%s\\n" "$*" >> "$STUB_STATE/notify-argv"', ': > "$STUB_STATE/notify-received"', HOLD_UNTIL_RELEASE, 'exit 0'].join(
      '\n',
    ),
  );
}, WARMUP_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Per-test sandbox
// ---------------------------------------------------------------------------------------------

interface Sandbox {
  home: string;
  project: string;
  state: string;
}

interface HookRun {
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
  output: () => string;
}

let sandbox: Sandbox;
let runs: HookRun[];

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-detach-case-'));
  sandbox = { home: path.join(root, 'home'), project: path.join(root, 'project'), state: path.join(root, 'state') };
  for (const dir of [sandbox.home, sandbox.project, sandbox.state]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(sandbox.home, '.oss'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(sandbox.home, '.oss/config.json'),
    JSON.stringify({ apiKey: 'fake-test-key-not-real', apiUrl: 'http://127.0.0.1:9' }),
  );
  runs = [];
});

afterEach(async () => {
  // Let every held stub go, then wait for the hooks to finish before deleting their sandbox.
  fs.writeFileSync(path.join(sandbox.state, 'release'), '');
  await Promise.all(runs.map((run) => Promise.race([run.closed, delay(MARKER_BACKSTOP_MS)])));
  fs.rmSync(path.dirname(sandbox.home), { recursive: true, force: true });
});

function hermeticEnv(pluginRoot: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('OSS_') || key.startsWith('CURL')) continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: sandbox.home,
    PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_STATE: sandbox.state,
    ...extra,
  };
}

/** Run a hook the way Claude Code does: stdio pipes, done only when every pipe reaches EOF. */
function startHook(script: string, args: string[], env: NodeJS.ProcessEnv): HookRun {
  const child = spawn('bash', [script, ...args], { cwd: sandbox.project, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** Resolves true when the hook's output closes, false if the hang backstop is hit first. */
async function outputCloses(run: HookRun): Promise<boolean> {
  await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
  return run.isClosed();
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

const releaseFile = (): string => path.join(sandbox.state, 'release');

// ---------------------------------------------------------------------------------------------

describe('Acceptance: a hook never keeps Claude Code waiting on its background work', () => {
  /**
   * @behavior Starting any /oss command is not slowed down by the analytics API.
   * @business-rule Usage analytics is fire-and-forget; it must never hold the command's start.
   */
  it(
    'workflow start: output closes while the analytics request is still in flight',
    async () => {
      // Given the analytics API is slow: the request is held open until we release it
      // (the sandbox apiUrl is http://127.0.0.1:9: plain http to a loopback API needs the opt-in, T20)
      const env = hermeticEnv(notifyPluginRoot, { CURL_STUB_HOLD: '1', OSS_ALLOW_HTTP_LOOPBACK: '1' });

      // When a workflow starts
      const run = startHook(path.join(notifyPluginRoot, 'hooks/oss-notify.sh'), ['--workflow', 'build', 'start', '{}'], env);

      // Then the analytics request was really made (otherwise this test proves nothing) ...
      const requested = await fileAppears(path.join(sandbox.state, 'curl-received'));
      expect(requested, 'the analytics request was never made (curl stub not reached)').toBe(true);
      expect(readIfExists(path.join(sandbox.state, 'curl-argv'))).toContain('/api/v1/analytics/track');

      // ... and the hook's output closes while that request is still in flight
      const closed = await outputCloses(run);
      expect(
        closed && !fs.existsSync(releaseFile()),
        `oss-notify.sh --workflow build start kept its stdout/stderr open while the analytics request was in flight ` +
          `(not closed ${CLOSE_BACKSTOP_MS / 1000} s after the request started; Claude Code would still be waiting)`,
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  /**
   * @behavior A pending plugin update notice does not delay the session.
   * @business-rule The update notice is shown later (after the session notification expires),
   *   but the session event itself returns at once.
   */
  it(
    'session event: output closes before the pending update notice is posted, and the notice is still posted',
    async () => {
      // Given an update notice is pending (check-updates.sh prints one)
      const env = hermeticEnv(notifyPluginRoot);
      const notice = 'setNotification OSS update available: 9.9.9 30';
      const nodeCalls = path.join(sandbox.state, 'node-calls');

      // When a session event fires
      const run = startHook(path.join(notifyPluginRoot, 'hooks/oss-notify.sh'), ['--session', 'fresh_start', '{"project":"p"}'], env);

      // Then the hook's output closes before the notice is posted
      const closed = await outputCloses(run);
      const postedAtClose = readIfExists(nodeCalls).includes(notice);
      expect(
        closed && !postedAtClose,
        closed
          ? `the update notice was posted before oss-notify.sh --session closed its output (notice delay ran in the foreground)`
          : `oss-notify.sh --session fresh_start kept its stdout/stderr open while the update notice was pending ` +
              `(not closed ${CLOSE_BACKSTOP_MS / 1000} s in; delay reached: ${fs.existsSync(path.join(sandbox.state, 'delay-received'))})`,
      ).toBe(true);

      // And the notice is still posted once its delay is over (control: the notice path is live)
      fs.writeFileSync(releaseFile(), '');
      let posted = false;
      for (let waited = 0; waited < MARKER_BACKSTOP_MS && !posted; waited += 50) {
        posted = readIfExists(nodeCalls).includes(notice);
        if (!posted) await delay(50);
      }
      expect(posted, `the update notice was never posted; node calls:\n${readIfExists(nodeCalls)}`).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  /**
   * @behavior Claude Code finishes starting a session without waiting for the status-line notification.
   * @business-rule Session start must not be held by its background notify call, in either branch
   *   (fresh start, or previous context restored).
   */
  describe('session start', () => {
    const cases: Array<{ branch: string; event: string; withSavedContext: boolean }> = [
      { branch: 'fresh start', event: 'fresh_start', withSavedContext: false },
      { branch: 'context restored', event: 'context_restored', withSavedContext: true },
    ];

    for (const { branch, event, withSavedContext } of cases) {
      it(
        `${branch}: output closes while the notify call is still running`,
        async () => {
          // Given the notify call is slow (holds until released), and for the restore branch a saved context
          if (withSavedContext) {
            fs.mkdirSync(path.join(sandbox.project, '.oss'), { recursive: true });
            fs.writeFileSync(
              path.join(sandbox.project, '.oss/session-context.md'),
              '# Session Context\n\n**Branch:** feat/x\n\n_Saved: 2026-01-01 10:00:00_\n',
            );
          }
          // OSS_SKIP_HEALTH_CHECK is deliberately NOT set: it disables the notify launch.
          const env = hermeticEnv(sessionPluginRoot);

          // When session start runs
          const run = startHook(path.join(sessionPluginRoot, 'hooks/oss-session-start.sh'), [], env);

          // Then the notify call was really launched, for this branch ...
          const launched = await fileAppears(path.join(sandbox.state, 'notify-received'));
          expect(launched, `session start never launched oss-notify.sh; output:\n${run.output()}`).toBe(true);
          expect(readIfExists(path.join(sandbox.state, 'notify-argv'))).toContain(`--session ${event}`);

          // ... and session start's output closes while that call is still running
          const closed = await outputCloses(run);
          expect(
            closed && !fs.existsSync(releaseFile()),
            `oss-session-start.sh (${branch}) kept its stdout/stderr open while oss-notify.sh --session ${event} was running ` +
              `(not closed ${CLOSE_BACKSTOP_MS / 1000} s in; Claude Code startup would still be waiting)`,
          ).toBe(true);
          expect(run.output()).toContain('OSS: Ready');
        },
        TEST_TIMEOUT_MS,
      );
    }
  });
});
