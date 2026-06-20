/**
 * agent-offload - Run a routable interactive agent's work on its configured local model
 * (e.g. gpt-oss@deepblue) by spawning a nested "mini-claudish" Claude session pointed at the
 * :3456 ModelProxy via ANTHROPIC_BASE_URL.
 *
 * This is the function each routable agent's `## Step 0.5` invokes. It is the ONLY place the
 * interactive client actually offloads inference to a local model — without it, agents merely
 * print a banner and keep reasoning on Claude.
 *
 * Design: DESIGN.md / PLAN.md in
 *   one-shot-ship-plugin/.oss/dev/active/interactive-local-model-offload/
 *
 * Behaviour contract (acceptance test:
 *   watcher/test/acceptance/interactive-local-model-offload.acceptance.test.ts):
 *   - Mapped agent (useProxy:true) + proxy reachable + nested session succeeds → offloaded:true
 *   - No mapping (useProxy:false) → offloaded:false, nothing spawned (default-OFF for customers)
 *   - Nested failure / proxy down → offloaded:false, fallback:true (native Claude takes over)
 *   - NEVER throws into the calling agent — a broken local route must never break the agent.
 *
 * Usage (CLI):
 *   node agent-offload.js --agent oss:code-reviewer --prompt-file /tmp/prompt.txt
 * Output (JSON): OffloadResult
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { checkAgentModel, CheckResult } from './agent-model-check.js';

export interface OffloadParams {
  /** Agent id, e.g. "oss:code-reviewer". */
  agent: string;
  /** Path to the assembled prompt (expert prompt + task context) fed to the nested session. */
  promptFile: string;
  /** Project dir for config precedence. Defaults to cwd. */
  projectDir?: string;
  /** Safety net (default true): on any offload failure, degrade to native Claude. */
  fallbackEnabled?: boolean;
}

export type OffloadReason = 'native' | 'proxy_down' | 'spawn_error' | 'empty_output';

export interface OffloadResult {
  /** True only when the local model actually produced the work. */
  offloaded: boolean;
  /** The local model's output (when offloaded). */
  output?: string;
  /** True when we degraded to native Claude instead of offloading. */
  fallback?: boolean;
  /** Why we did not offload. */
  reason?: OffloadReason;
  /** Error detail (failures only). */
  error?: string;
}

/** Injectable collaborators (London TDD — mirrors the repo's `_testSpawn` idiom). */
export interface OffloadDeps {
  checkAgentModel?: (p: { agentName: string; projectDir: string }) => Promise<CheckResult>;
  isProxyReachable?: (url: string) => Promise<boolean>;
  spawnFn?: typeof childProcess.spawn;
  readPrompt?: (file: string) => string;
  startProxy?: (opts: { model: string; port: number }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Pure: build the nested-session invocation. The base URL is what diverts inference to the
 * local model; OSS_OFFLOAD_ACTIVE=1 is the depth-1 recursion guard (see agent-model-check).
 */
export function buildOffloadInvocation(
  routing: CheckResult,
): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    cmd: 'claude',
    // Deliberately NO `--model <local>`: the Claude CLI validates --model against known Claude
    // ids and rejects a foreign one client-side (before any request). The OSS ModelProxy
    // (ANTHROPIC_BASE_URL) force-selects the configured local model, so the nested session runs
    // on its default id and the proxy overrides it. (live-proof finding)
    args: ['-p', '--dangerously-skip-permissions'],
    env: stripModelEnv({
      ...process.env,
      ANTHROPIC_BASE_URL: routing.proxyUrl as string,
      OSS_OFFLOAD_ACTIVE: '1',
    }),
  };
}

/**
 * Sanitize the nested session's env:
 * - Drop ANTHROPIC_MODEL — the parent may export an exotic id (e.g. `claude-opus-4-8[1m]`) the
 *   nested `claude -p` would reject client-side; the proxy force-selects the real local model anyway.
 * - Replace the real Anthropic credentials with a dummy key and drop the auth token. The nested
 *   session talks only to the local proxy (which ignores auth and forwards to the local model), so
 *   it never needs the real key — and we must not hand it to a localhost listener / redirected base URL.
 */
function stripModelEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.ANTHROPIC_MODEL;
  delete out.ANTHROPIC_AUTH_TOKEN;
  out.ANTHROPIC_API_KEY = 'oss-offload-local'; // dummy: lets claude -p start; proxy ignores it
  return out;
}

/** Pure: classify a finished nested run. */
export function classifyResult(
  exitCode: number,
  stdout: string,
): 'success' | 'empty_output' | 'spawn_error' {
  if (exitCode !== 0) return 'spawn_error';
  if (stdout.trim().length === 0) return 'empty_output';
  return 'success';
}

/** Default real proxy health probe: a quick GET with a short timeout. */
function defaultIsProxyReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function degrade(reason: OffloadReason, fallbackEnabled: boolean, error?: string): OffloadResult {
  return { offloaded: false, fallback: fallbackEnabled, reason, ...(error ? { error } : {}) };
}

/** Extract the port from a proxy URL (defaults to 3456). */
function parseProxyPort(url: string): number {
  try {
    return Number(new URL(url).port) || 3456;
  } catch {
    return 3456;
  }
}

/**
 * Default: start the OSS ModelProxy (detached) for the given model + port. start-proxy reads the
 * remote ollama base URL from config (models.apiKeys.ollama). start-proxy.js is a sibling of this
 * file in dist/cli. Never throws.
 */
function defaultStartProxy(opts: { model: string; port: number }): Promise<void> {
  return new Promise((resolve) => {
    try {
      const script = path.join(path.dirname(process.argv[1] ?? ''), 'start-proxy.js');
      // Run start-proxy in its foreground (server) mode but detached + unref'd so it binds and
      // outlives this runner. NOTE: do NOT use --background — that mode returns before the
      // detached child binds and the child dies.
      const child = childProcess.spawn(
        'node',
        [script, '--model', opts.model, '--port', String(opts.port)],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();
    } catch {
      /* never break the agent */
    }
    resolve();
  });
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run the agent's work on its configured local model via a nested mini-claudish session.
 * Resolves (never rejects) — any failure degrades to a native-Claude signal.
 */
export async function runAgentOffload(
  params: OffloadParams,
  deps: OffloadDeps = {},
): Promise<OffloadResult> {
  const fallbackEnabled = params.fallbackEnabled !== false; // default true
  const resolveRouting = deps.checkAgentModel ?? checkAgentModel;
  const isProxyReachable = deps.isProxyReachable ?? defaultIsProxyReachable;
  const spawnFn = deps.spawnFn ?? childProcess.spawn;
  const readPrompt = deps.readPrompt ?? ((f: string) => fs.readFileSync(f, 'utf8'));
  const startProxy = deps.startProxy ?? defaultStartProxy;
  const sleep = deps.sleep ?? defaultSleep;

  try {
    // 1. Resolve routing. No mapping → native (default-OFF for every customer).
    const routing = await resolveRouting({
      agentName: params.agent,
      projectDir: params.projectDir ?? process.cwd(),
    });
    if (!routing.useProxy || !routing.model || !routing.proxyUrl) {
      return { offloaded: false, reason: 'native' };
    }

    // 2. Preflight + auto-start: if the proxy isn't running, start it for this model/port and
    // wait for it to come up. Only fall back if it still can't be reached.
    if (!(await isProxyReachable(routing.proxyUrl))) {
      await startProxy({ model: routing.model, port: parseProxyPort(routing.proxyUrl) });
      let up = false;
      for (let i = 0; i < 60; i++) {
        if (await isProxyReachable(routing.proxyUrl)) {
          up = true;
          break;
        }
        await sleep(250); // up to ~15s for the detached proxy to bind
      }
      if (!up) return degrade('proxy_down', fallbackEnabled);
    }

    // 3. Assemble the prompt and spawn the nested session.
    const promptText = readPrompt(params.promptFile);
    const { cmd, args, env } = buildOffloadInvocation(routing);
    const child = spawnFn(cmd, args, { env });

    return await new Promise<OffloadResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer | string) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr += d.toString();
      });
      child.on('error', (err: Error) => {
        resolve(degrade('spawn_error', fallbackEnabled, err.message));
      });
      child.on('close', (code: number) => {
        const verdict = classifyResult(code ?? 0, stdout);
        if (verdict === 'success') {
          resolve({ offloaded: true, output: stdout });
        } else {
          resolve(degrade(verdict, fallbackEnabled, stderr.trim() || undefined));
        }
      });

      // Feed the assembled prompt on stdin.
      try {
        child.stdin?.write(promptText);
        child.stdin?.end();
      } catch {
        /* a stdin failure surfaces via 'error'/'close' above */
      }
    });
  } catch (err) {
    // Absolute safety net: never throw into the calling agent.
    return degrade('spawn_error', fallbackEnabled, (err as Error)?.message);
  }
}

// --- CLI entrypoint ---------------------------------------------------------

export function parseOffloadArgs(argv: string[]): OffloadParams {
  let agent = '';
  let promptFile = '';
  let projectDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = argv[++i];
    else if (argv[i] === '--prompt-file') promptFile = argv[++i];
    else if (argv[i] === '--project-dir') projectDir = argv[++i];
  }
  return { agent, promptFile, projectDir };
}

// Run as CLI when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]).includes(`${path.sep}agent-offload`);

if (invokedDirectly) {
  const params = parseOffloadArgs(process.argv.slice(2));
  if (!params.agent || !params.promptFile) {
    process.stdout.write(
      JSON.stringify({ offloaded: false, reason: 'native', error: '--agent and --prompt-file required' }),
    );
    process.exit(0);
  }
  runAgentOffload(params)
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    })
    .catch(() => {
      // Never fail the calling agent.
      process.stdout.write(JSON.stringify({ offloaded: false, fallback: true, reason: 'spawn_error' }));
      process.exit(0);
    });
}
