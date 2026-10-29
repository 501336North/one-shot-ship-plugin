/**
 * @behavior Logging an agent delegation (`oss-log.sh agent <cmd> <agent> "starting: …"` or
 *   "completed: …") hands control back to the caller at once, while the status-line state update
 *   it fires is still running.
 * @business-rule The status-line state update is fire-and-forget: a slow `node` must never hold the
 *   command that logged the delegation, and the active agent is still recorded.
 * @boundary hooks/oss-log.sh agent, run as Claude Code runs it (piped stdio, done only when stdout
 *   AND stderr reach EOF).
 *
 * Hermetic and free of wall-clock assertions (same harness as oss-notify-analytics-detach.test.ts):
 * - per-test HOME (mkdtemp); CLAUDE_*, OSS_* and CURL* removed from the env; a sandbox bin/ first
 *   on PATH whose `node` is a stub.
 * - the hook runs from a sandbox plugin root holding the real oss-log.sh and oss-safe-path.sh, and a
 *   placeholder watcher/dist/cli/update-workflow-state.js so the state update path is taken.
 * - the node stub records its argv, writes `received`, and waits for `release`.
 * - with a project: CLAUDE_PROJECT_DIR points at a sandbox project holding .oss (the
 *   --project-dir variant). Without: no CLAUDE_PROJECT_DIR and no .git above the cwd.
 * - the update is detached and outlives the hook, so teardown waits for every stub call to finish.
 * - stubs are created and executed once in beforeAll (OSS_STUB_WARMUP=1), never inside a test.
 * - time limits are only hang backstops; hitting one is a failure with a message.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_HOOKS = path.join(__dirname, '../../../hooks');

const CLOSE_BACKSTOP_MS = 15_000;
const MARKER_BACKSTOP_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;
const WARMUP_TIMEOUT_MS = 180_000;

const WARMUP_GUARD = '[ -n "${OSS_STUB_WARMUP:-}" ] && exit 0';
const HOLD_UNTIL_RELEASE =
  'i=0; while [ ! -e "$STUB_STATE/release" ] && [ "$i" -lt 600 ]; do sleep 0.05; i=$((i+1)); done';

let fixtureRoot: string;
let binDir: string;
let pluginRoot: string;

function writeStub(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/bash\n${WARMUP_GUARD}\n${body}\n`, { mode: 0o755 });
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-agent-detach-'));
  binDir = path.join(fixtureRoot, 'bin');
  pluginRoot = path.join(fixtureRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });

  // node: the agent action runs `node "$UPDATE_CLI" [--project-dir DIR] <action> …` in the background.
  writeStub(
    path.join(binDir, 'node'),
    [
      '[ -n "${STUB_STATE:-}" ] || exit 0',
      // One line per call; newlines inside an argument (jq's pretty JSON) become spaces.
      `{ for a in "$@"; do printf "%s " "\${a//$'\\n'/ }"; done; echo; } >> "$STUB_STATE/node-argv"`,
      ': > "$STUB_STATE/node-received"',
      HOLD_UNTIL_RELEASE,
      // Last write of every call: teardown waits on it, so nothing writes into STUB_STATE after.
      'echo done >> "$STUB_STATE/node-done"',
      'exit 0',
    ].join('\n'),
  );

  for (const name of ['oss-log.sh', 'oss-safe-path.sh']) {
    fs.copyFileSync(path.join(REPO_HOOKS, name), path.join(pluginRoot, 'hooks', name));
    fs.chmodSync(path.join(pluginRoot, 'hooks', name), 0o755);
  }
  const wfCli = path.join(pluginRoot, 'watcher/dist/cli/update-workflow-state.js');
  fs.mkdirSync(path.dirname(wfCli), { recursive: true });
  fs.writeFileSync(wfCli, '// stub path; `node` on PATH is a recording stub\n');

  execFileSync(path.join(binDir, 'node'), [], { env: { ...process.env, OSS_STUB_WARMUP: '1' }, stdio: 'ignore' });
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
let projectDir: string;
let runs: HookRun[];

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-agent-detach-case-'));
  stateDir = path.join(caseRoot, 'state');
  projectDir = path.join(caseRoot, 'project');
  for (const dir of ['home/.oss', 'project/.oss', 'cwd', 'state']) {
    fs.mkdirSync(path.join(caseRoot, dir), { recursive: true });
  }
  runs = [];
});

afterEach(async () => {
  fs.writeFileSync(path.join(stateDir, 'release'), '');
  await Promise.all(runs.map((run) => Promise.race([run.closed, delay(MARKER_BACKSTOP_MS)])));
  // The update is detached, so it can outlive the hook: wait for both chained calls of every run.
  await waitForFile(path.join(stateDir, 'node-done'), (text) => text.split('\n').length - 1 >= 2 * runs.length);
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function logAgent(task: string, withProject: boolean): HookRun {
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
    ...(withProject ? { CLAUDE_PROJECT_DIR: projectDir } : {}),
  });
  const child = spawn(
    'bash',
    [path.join(pluginRoot, 'hooks/oss-log.sh'), 'agent', 'build', 'react-specialist', task],
    { cwd: path.join(caseRoot, 'cwd'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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

async function waitForFile(file: string, predicate: (text: string) => boolean = () => true): Promise<boolean> {
  for (let waited = 0; waited < MARKER_BACKSTOP_MS; waited += 50) {
    if (fs.existsSync(file) && predicate(fs.readFileSync(file, 'utf8'))) return true;
    await delay(50);
  }
  return false;
}

function nodeCalls(): string[] {
  const file = path.join(stateDir, 'node-argv');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [];
}

const variants = [
  { name: 'starting, with a project', task: 'starting: UserProfile component', withProject: true },
  { name: 'starting, without a project', task: 'starting: UserProfile component', withProject: false },
  { name: 'completed, with a project', task: 'completed: UserProfile component', withProject: true },
  { name: 'completed, without a project', task: 'completed: UserProfile component', withProject: false },
];

describe('oss-log.sh agent: status-line state update', () => {
  for (const variant of variants) {
    it(
      `should close its output while the state update is still running (${variant.name})`,
      async () => {
        const run = logAgent(variant.task, variant.withProject);

        expect(
          await waitForFile(path.join(stateDir, 'node-received')),
          'the state update (node update-workflow-state.js) was never started',
        ).toBe(true);
        expect(
          nodeCalls()[0]?.includes('--project-dir'),
          `wrong variant reached: ${JSON.stringify(nodeCalls())}`,
        ).toBe(variant.withProject);

        await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);
        expect(
          run.isClosed() && !fs.existsSync(path.join(stateDir, 'release')),
          `oss-log.sh kept its stdout/stderr open while the state update was running ` +
            `(not closed ${CLOSE_BACKSTOP_MS / 1000} s after the update started)`,
        ).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );
  }

  it(
    'should still record the active agent',
    async () => {
      const run = logAgent('starting: UserProfile component', true);

      expect(await waitForFile(path.join(stateDir, 'node-received')), 'the state update was never started').toBe(true);
      fs.writeFileSync(path.join(stateDir, 'release'), '');
      await Promise.race([run.closed, delay(CLOSE_BACKSTOP_MS)]);

      expect(
        await waitForFile(path.join(stateDir, 'node-argv'), (text) => text.includes('setActiveAgent')),
        `setActiveAgent never called: ${JSON.stringify(nodeCalls())}`,
      ).toBe(true);
      const call = nodeCalls().find((line) => line.includes('setActiveAgent')) ?? '';
      expect(call).toContain('"type": "react-specialist"');
      expect(call).toContain('UserProfile component');
    },
    TEST_TIMEOUT_MS,
  );
});
