#!/usr/bin/env node
/**
 * tool-gate CLI: called by hooks/oss-tool-gate.sh with the hook JSON on stdin.
 *
 * Usage:
 *   node tool-gate.cjs pre  < hook.json   # PreToolUse: allow (exit 0) or refuse (exit 2 + stderr)
 *   node tool-gate.cjs post < hook.json   # PostToolUse / PostToolUseFailure: record a test run
 *
 * Exit codes: 0 allow (stdout empty, or one allow-and-tell JSON line), 2 refuse, 1 wrong usage
 * (the hook wrapper turns any exit other than 0 or 2 into allow-and-tell).
 *
 * The decision runs in a worker thread (this same file), ended at a hard time limit: the gate's
 * own 2 s timer can't interrupt synchronous work, and a decision that kept running would leave a
 * process spinning after Claude Code gives up on the hook. At the limit (or if the worker
 * crashes) the call is allowed, `gate-error` is logged and the agent is told (ADR-005).
 */

import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { gateErrorResult, runToolGate, type GateResult } from '../tool-gate/gate.js';
import { killGroup, runGit, setGitRunner } from '../tool-gate/git-reader.js';

const USAGE = 'Usage: tool-gate pre|post < hook.json\n';

/**
 * How long the worker may take before it is ended. Above the gate's own 2 s limit (which answers
 * a hung git read itself) and well below Claude Code's 5 s hook timeout (hooks.json).
 */
export const HARD_LIMIT_MS = 2500;

type Env = Record<string, string | undefined>;

/** What the main thread hands the worker. */
interface WorkerRequest {
  argv: string[];
  input: string;
  env: Env;
}

/**
 * The plugin root when CLAUDE_PLUGIN_ROOT is missing or empty: this file sits in
 * <plugin>/watcher/dist/cli/ (the cjs bundle, which has `__dirname`), three folders below it.
 * '' when unknown (an ESM build has no `__dirname`): the gate then fails with gate-error rather
 * than read the base rules from the working folder, which the repo controls.
 */
function ownPluginRoot(): string {
  return typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..', '..') : '';
}

function modeOf(argv: readonly string[]): 'pre' | 'post' | null {
  const mode = argv[0];
  return mode === 'pre' || mode === 'post' ? mode : null;
}

function gateEnv(env: Env): { HOME: string; CLAUDE_PLUGIN_ROOT: string; CLAUDE_PROJECT_DIR?: string; CDPATH?: string } {
  const { HOME = '', CLAUDE_PROJECT_DIR, CDPATH } = env;
  return { HOME, CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(), CLAUDE_PROJECT_DIR, CDPATH };
}

export async function runCli(argv: readonly string[], input: string, env: Env): Promise<GateResult> {
  const mode = modeOf(argv);
  if (mode === null) return { exitCode: 1, stdout: '', stderr: USAGE };
  return runToolGate({ mode, input, env: gateEnv(env) });
}

function isGateResult(value: unknown): value is GateResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.exitCode === 'number' && typeof v.stdout === 'string' && typeof v.stderr === 'string';
}

/** What the worker posts to have the main thread run git for it (fix round 4, K2). */
interface GitRun {
  id: number;
  gitBin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxLines: number;
}

function gitRunOf(value: unknown): GitRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const run = (value as Record<string, unknown>).gitRun;
  if (typeof run !== 'object' || run === null) return null;
  const r = run as Record<string, unknown>;
  const ok =
    typeof r.id === 'number' &&
    typeof r.gitBin === 'string' &&
    Array.isArray(r.args) &&
    r.args.every((a) => typeof a === 'string') &&
    typeof r.cwd === 'string' &&
    typeof r.timeoutMs === 'number' &&
    typeof r.maxLines === 'number';
  return ok ? (run as GitRun) : null;
}

/** What the main thread posts back: git's stdout, or null. */
interface GitResult {
  id: number;
  out: string | null;
}

function gitResultOf(value: unknown): GitResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = (value as Record<string, unknown>).gitResult;
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  return typeof r.id === 'number' && (typeof r.out === 'string' || r.out === null) ? { id: r.id, out: r.out } : null;
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.argv) && typeof v.input === 'string' && typeof v.env === 'object' && v.env !== null;
}

/**
 * Runs the decision in a worker running `script`, and answers with what it posts. A worker that
 * posts nothing usable, crashes, or is still running after `limitMs` is ended: the call is
 * allowed with gate-error and the tell line. The worker never starts git itself: it asks this
 * thread, which starts git in its own process group and knows that group the moment it starts, so
 * every group still running when the decision ends is killed (ending the worker would leave them
 * running), and nothing is started once it has ended.
 */
export function decideInWorker(
  script: string,
  argv: readonly string[],
  input: string,
  env: Env,
  limitMs = HARD_LIMIT_MS,
): Promise<GateResult> {
  const mode = modeOf(argv);
  if (mode === null) return Promise.resolve({ exitCode: 1, stdout: '', stderr: USAGE });
  const request: WorkerRequest = { argv: [...argv], input, env };
  return new Promise((resolve) => {
    const worker = new Worker(script, { workerData: { toolGate: request } });
    let done = false;
    const running = new Set<number>();
    const finish = (result: GateResult | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeAllListeners('message');
      void worker.terminate();
      for (const pid of running) killGroup(pid);
      resolve(result ?? gateErrorResult({ mode, input, env: gateEnv(env) }));
    };
    const timer = setTimeout(() => finish(null), limitMs);
    const tracker = { started: (pid: number) => running.add(pid), ended: (pid: number) => running.delete(pid) };
    worker.on('message', (message: unknown) => {
      const run = gitRunOf(message);
      if (run === null) {
        finish(isGateResult(message) ? message : null);
        return;
      }
      // started synchronously, so its group is known before anything else can end the decision
      void runGit(run.gitBin, run.args, run.cwd, run.timeoutMs, run.maxLines, tracker).then((out) => {
        if (!done) worker.postMessage({ gitResult: { id: run.id, out } });
      });
    });
    worker.once('error', () => finish(null));
    worker.once('exit', () => finish(null));
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

/** Writes the answer, then exits once both streams have flushed (pipes are async on macOS). */
function answer(result: GateResult): void {
  process.stderr.write(result.stderr, () => {
    process.stdout.write(result.stdout, () => process.exit(result.exitCode));
  });
}

const request: unknown = isMainThread ? undefined : (workerData as { toolGate?: unknown } | null)?.toolGate;

if (isWorkerRequest(request)) {
  // The worker: decide, and hand the answer to the main thread, which runs each git for it.
  const waiting = new Map<number, (out: string | null) => void>();
  let nextId = 0;
  parentPort?.on('message', (message: unknown) => {
    const result = gitResultOf(message);
    if (result === null) return;
    waiting.get(result.id)?.(result.out);
    waiting.delete(result.id);
  });
  setGitRunner(
    (gitBin, args, cwd, timeoutMs, maxLines) =>
      new Promise((resolve) => {
        const id = nextId++;
        waiting.set(id, resolve);
        parentPort?.postMessage({ gitRun: { id, gitBin, args, cwd, timeoutMs, maxLines } });
      }),
  );
  void runCli(request.argv, request.input, request.env).then(
    (result) => parentPort?.postMessage(result),
    () => parentPort?.postMessage(null),
  );
} else if (isMainThread && /tool-gate\.(js|cjs)$/.test(process.argv[1] || '')) {
  // Only run when executed directly (not imported by tests); .js (tsc) and .cjs (bundle).
  const script = path.resolve(process.argv[1]);
  readStdin()
    .then((input) => decideInWorker(script, process.argv.slice(2), input, process.env))
    .then(answer, () => answer({ exitCode: 1, stdout: '', stderr: 'tool-gate: could not read the hook input\n' }));
}
