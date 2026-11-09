/**
 * The tool gate's boundary: one Claude Code hook call in, one answer out.
 *
 * - `pre` (PreToolUse): checks a Bash or edit-tool call against the rules. Allow is exit 0
 *   with no stdout (never a permission decision); refuse is exit 2 with the reason on stderr.
 * - `post` (PostToolUse / PostToolUseFailure on Bash): records a test run.
 *
 * Rules and state are found from the hook's `cwd`: the repo root is the nearest folder holding
 * `.git` (or `cwd` outside a repo). Rule files, `.oss/tool-gates/` and `.oss/workflow-state.json`
 * all live there. A crash or a decision slower than 2 s allows the call, logs `gate-error` and
 * tells the agent (ADR-005). A rejected repo rule file is reported on every call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCommand } from './command-reader.js';
import { readEditCall } from './edit-call.js';
import { realGitReader, type GitReader } from './git-reader.js';
import { realPathResolver } from './path-resolver.js';
import { recordTestRun } from './recorder.js';
import { loadSettings, type GateSettings } from './rule-file.js';
import { checkFocusedTests } from './rules/focused-tests.js';
import { checkForcePush } from './rules/force-push.js';
import { checkProductionHost } from './rules/production-host.js';
import { checkProtectedBranch } from './rules/protected-branch.js';
import { checkProtectedPathBash, checkProtectedPathEdit } from './rules/protected-path.js';
import { checkRedCycle } from './rules/red-cycle.js';
import type { Refusal } from './rules/refusal.js';
import { checkTags } from './rules/tags.js';
import { fileStateStore, type StateStore } from './state-store.js';
import { fileWorkflowState } from './workflow-state.js';

export type { GitReader };

export type GateMode = 'pre' | 'post';

export interface GateRequest {
  mode: GateMode;
  input: string;
  env: { HOME: string; CLAUDE_PLUGIN_ROOT: string };
}

export interface GateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Collaborators that can be swapped in tests. The recorder needs none that start a process (AC-005.5). */
export interface GateDeps {
  gitReader?: GitReader;
}

const TELL = 'tool-gate failed, rules not checked.';
const TIMEOUT_MS = 2000;
const HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

interface HookCall {
  cwd: string;
  hookEventName: string;
  toolName: string;
  toolInput: unknown;
  error?: string;
  isInterrupt?: boolean;
}

interface Context {
  hook: HookCall;
  root: string;
  home: string;
  settings: GateSettings;
  store: StateStore;
  git: GitReader;
  ts: string;
}

function readHook(input: string): HookCall {
  const data: unknown = JSON.parse(input);
  if (typeof data !== 'object' || data === null) throw new Error('hook input is not an object');
  const record = data as Record<string, unknown>;
  if (typeof record.cwd !== 'string' || typeof record.tool_name !== 'string') {
    throw new Error('hook input has no cwd or tool_name');
  }
  return {
    cwd: record.cwd,
    hookEventName: typeof record.hook_event_name === 'string' ? record.hook_event_name : '',
    toolName: record.tool_name,
    toolInput: record.tool_input,
    error: typeof record.error === 'string' ? record.error : undefined,
    isInterrupt: record.is_interrupt === true,
  };
}

/** The nearest folder at or above `cwd` holding `.git` (a folder, or a worktree's file); `cwd` when none. */
function repoRootOf(cwd: string): string {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return cwd;
  }
}

function readFileOrNull(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function bashCommand(toolInput: unknown): string | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const command = (toolInput as Record<string, unknown>).command;
  return typeof command === 'string' ? command : null;
}

/** Exit 0, with the text as context for the agent (no permission decision), or nothing at all. */
function allow(hookEventName: string, context?: string): GateResult {
  if (context === undefined) return { exitCode: 0, stdout: '', stderr: '' };
  const output = { hookSpecificOutput: { hookEventName, additionalContext: context } };
  return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
}

async function checkBash(ctx: Context, command: string): Promise<Refusal | null> {
  const { hook, root, home, settings } = ctx;
  const facts = readCommand(command, hook.cwd, home);
  if ('unreadable' in facts) {
    ctx.store.appendEvent({ ts: ctx.ts, tool: hook.toolName, kind: 'unreadable', command, result: 'allowed' });
    return null;
  }
  for (const part of facts.parts) {
    const refusal =
      (await checkProtectedBranch(part, settings, ctx.git)) ??
      checkForcePush(part, settings) ??
      checkTags(part, settings) ??
      checkProductionHost(part, settings) ??
      checkProtectedPathBash(part, settings, root, home, realPathResolver);
    if (refusal !== null) return refusal;
  }
  return null;
}

function checkEdit(ctx: Context): Refusal | null {
  const { hook, root, home, settings } = ctx;
  const call = readEditCall(hook.toolName, hook.toolInput, hook.cwd, home, readFileOrNull);
  if (call === null) return null;
  return (
    checkProtectedPathEdit(call, settings, root, home, realPathResolver) ??
    checkFocusedTests(call, settings, root, home) ??
    checkRedCycle(call, settings, root, home, fileWorkflowState(root), ctx.store)
  );
}

function record(ctx: Context, command: string): void {
  const { hook } = ctx;
  if (hook.hookEventName !== 'PostToolUse' && hook.hookEventName !== 'PostToolUseFailure') return;
  const workflow = fileWorkflowState(ctx.root).read();
  recordTestRun(
    { hookEvent: hook.hookEventName, command, cwd: hook.cwd, error: hook.error, isInterrupt: hook.isInterrupt },
    {
      settings: ctx.settings,
      store: ctx.store,
      home: ctx.home,
      ts: ctx.ts,
      buildStartedAt: workflow?.currentCommandStartedAt ?? null,
      currentCommand: workflow?.currentCommand ?? null,
    },
  );
}

async function decide(req: GateRequest, call: Omit<Context, 'settings'>): Promise<GateResult> {
  const loaded = loadSettings(readFileOrNull, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const ctx: Context = { ...call, settings: loaded.settings };
  const { hook } = ctx;
  const command = hook.toolName === 'Bash' ? bashCommand(hook.toolInput) : null;
  let refusal: Refusal | null = null;
  if (req.mode === 'post') {
    if (command !== null) record(ctx, command);
  } else {
    refusal = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
  }

  if (refusal !== null) {
    ctx.store.appendEvent({
      ts: ctx.ts,
      tool: hook.toolName,
      kind: 'refusal',
      rule: refusal.rule,
      ...(command !== null ? { command } : {}),
      result: 'refused',
    });
  }
  if (loaded.rejected !== undefined) {
    ctx.store.appendEvent({
      ts: ctx.ts,
      tool: hook.toolName,
      kind: 'rule-file-rejected',
      result: refusal !== null ? 'refused' : 'allowed',
    });
  }
  if (refusal !== null) {
    const stderr = loaded.rejected === undefined ? refusal.reason : `${refusal.reason}\n${loaded.rejected}`;
    return { exitCode: 2, stdout: '', stderr: `${stderr}\n` };
  }
  return allow(hook.hookEventName, loaded.rejected);
}

export async function runToolGate(req: GateRequest, deps: GateDeps = {}): Promise<GateResult> {
  let hook: HookCall | null = null;
  let store: StateStore | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    hook = readHook(req.input);
    const root = repoRootOf(hook.cwd);
    store = fileStateStore(root);
    const call = { hook, root, home: req.env.HOME, store, git: deps.gitReader ?? realGitReader, ts: new Date().toISOString() };
    const result = await Promise.race([decide(req, call), timedOut]);
    if (result === null) throw new Error('tool-gate timed out');
    return result;
  } catch {
    try {
      store?.appendEvent({
        ts: new Date().toISOString(),
        tool: hook?.toolName ?? 'unknown',
        kind: 'gate-error',
        result: 'allowed',
      });
    } catch {
      // Logging is best effort; the call is allowed either way.
    }
    const event =
      hook !== null && HOOK_EVENTS.has(hook.hookEventName)
        ? hook.hookEventName
        : req.mode === 'pre'
          ? 'PreToolUse'
          : 'PostToolUse';
    return allow(event, TELL);
  } finally {
    clearTimeout(timer);
  }
}
