/**
 * The tool gate's boundary: one Claude Code hook call in, one answer out.
 *
 * - `pre` (PreToolUse): checks a Bash or edit-tool call against the rules. Allow is exit 0
 *   with no stdout (never a permission decision); refuse is exit 2 with the reason on stderr.
 * - `post` (PostToolUse / PostToolUseFailure on Bash): records a test run.
 *
 * Rules and state are found from the project folder: Claude Code's `CLAUDE_PROJECT_DIR` when it is
 * an existing absolute folder (so a `.git` planted in a subfolder can't move it), else the nearest
 * folder at or above the hook's `cwd` holding `.git` (or `cwd` outside a repo). Rule files,
 * `.oss/tool-gates/` and the workflow state (.oss/workflow-state.json) all live there. A crash or
 * a decision slower than 2 s allows the call, logs `gate-error` and tells the agent (ADR-005); the
 * CLI runs this in a worker thread it ends at a hard limit, since a timer can't stop synchronous
 * work. A rejected repo rule file is reported on every call. Logging a pre-call decision is best effort: a log that can't be written never turns a refusal into an allow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCommand } from './command-reader.js';
import { readEditCall, readEditTarget } from './edit-call.js';
import { budgetedGitReader, OverBudget } from './budget.js';
import { withDeadline } from './deadline.js';
import { gitReaderFor, type GitReader } from './git-reader.js';
import { createPathResolver, type PathResolver } from './path-resolver.js';
import { readRegularFile } from './regular-file.js';
import { findRepo, repoTrust } from './repo-finder.js';
import { recordTestRun } from './recorder.js';
import { createTreeFinder, type TreeFinder } from './tree-finder.js';
import { loadSettings, type GateSettings } from './rule-file.js';
import { callingAgentOf } from './calling-agent.js';
import { checkGateAgentBash, checkGateAgentEdit } from './rules/gate-agent-write.js';
import { checkFocusedTests } from './rules/focused-tests.js';
import { checkForcePush } from './rules/force-push.js';
import { checkGitClean } from './rules/git-clean.js';
import { checkProductionHost } from './rules/production-host.js';
import { checkBranchRefs, checkBranchSwitch, checkHistoryMove, checkProtectedBranch, checkRepoTrust, trustForCall } from './rules/protected-branch.js';
import { checkProtectedPathBash, checkProtectedPathEdit, placesOf } from './rules/protected-path.js';
import { checkCallSize, checkProtectedPathMention } from './rules/protected-path-mention.js';
import { branchCreatedBefore, checkPushSetup } from './rules/push-setup.js';
import { checkRedCycle } from './rules/red-cycle.js';
import type { Refusal } from './rules/refusal.js';
import { checkTags } from './rules/tags.js';
import { checkUnknownGitOption, checkUnreadable, tooComplex } from './rules/unreadable.js';
import { fileStateStore, programField, type GateEvent, type StateStore } from './state-store.js';
import { UNKNOWN } from './tokenize.js';
import { fileWorkflowState } from './workflow-state.js';

export type { GitReader };

export type GateMode = 'pre' | 'post';

export interface GateRequest {
  mode: GateMode;
  input: string;
  /** `CDPATH`: the folders `cd` searches in the shell the call runs in, when set (K8). */
  env: { HOME: string; CLAUDE_PLUGIN_ROOT: string; CLAUDE_PROJECT_DIR?: string; CDPATH?: string };
}

export interface GateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Collaborators that can be swapped in tests. The recorder needs none that start a process (AC-005.5). */
export interface GateDeps {
  gitReader?: GitReader;
  /** The platform whose file system the paths are on; `process.platform` when absent. */
  platform?: NodeJS.Platform;
  /** The clock the per-call deadline is read from (milliseconds); `performance.now` when absent. */
  clock?: () => number;
}

/**
 * Platforms whose default file system ignores letter case (APFS, NTFS), so `.OSS/x` is `.oss/x`.
 * A code constant (a file-system fact), not a rule value.
 */
const CASE_INSENSITIVE_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32']);

/**
 * Per-call work limits (code constants, not rule values; fix round 4, K1). Ordinary calls use a
 * few git runs and a few hundred names; past a limit the call is refused as too complex.
 * - git: different questions per call, and the time git may take in all (under the 2 s limit).
 * - disk: names looked up, and names walked (a link's target counts each time it is followed).
 */
const GIT_LIMITS = { maxRuns: 8, timeMs: 1200 };
const PATH_LIMITS = { maxLookups: 20_000, maxSteps: 200_000 };
/**
 * - folders searched below a recursive delete for a nested `.git` (fix round 4, K3), and the time
 *   the search may take: a cold disk reads about 10000 folders a second, so the call stays under 2 s.
 */
const TREE_LIMITS = { maxDirs: 10_000, maxEntries: 200_000, timeMs: 1000 };
/**
 * - the whole decision (fix round 4, K8): every loop an input can make long looks at this deadline
 *   (deadline.ts) and refuses past it, well before the CLI's hard limit, where a call is allowed
 *   unchecked. 1.0 s (fix part K12, user decision), leaving the CLI's 2 s limit a full second of slack.
 */
const DECISION_MS = 1000;

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
  /** The calling subagent's name; undefined for the main agent. */
  agent?: string;
}

interface Context {
  hook: HookCall;
  root: string;
  home: string;
  settings: GateSettings;
  store: StateStore;
  git: GitReader;
  /** Resolves paths on disk for this call only, within PATH_LIMITS. */
  paths: PathResolver;
  /** Searches folders on disk for this call only, within TREE_LIMITS. */
  tree: TreeFinder;
  ts: string;
  caseInsensitive: boolean;
  /** The CDPATH the session runs with, if any. */
  cdpath: string | undefined;
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
    agent: callingAgentOf(record),
  };
}

/** The nearest folder at or above `cwd` holding `.git` (a folder, or a worktree's file); `cwd` when none. */
function repoRootOf(cwd: string): string {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return cwd;
  }
}

/**
 * Where `git rev-parse --show-toplevel` leads from `dir`, found as git finds it (a `.git` folder git
 * would skip is skipped); null outside a repo or wherever the gate can't be sure (fix round 4, K2).
 */
function toplevelOf(dir: string): string | null {
  const repo = findRepo(dir);
  return repo.kind === 'repo' ? repo.top : null;
}

/** CLAUDE_PROJECT_DIR when it is an existing absolute folder, else the nearest `.git` above `cwd`. */
function projectRootOf(projectDir: string | undefined, cwd: string): string {
  const usable =
    projectDir !== undefined &&
    path.isAbsolute(projectDir) &&
    fs.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : repoRootOf(cwd);
}

/**
 * Largest existing file a Write's "before" is read from. A code constant (a filesystem read
 * limit), not a rule value: a bigger file, or anything that is not a regular file (a named pipe
 * would block the read), counts as empty.
 */
const MAX_WRITE_BEFORE_BYTES = 5 * 1024 * 1024;

/** Largest rule file read (a read limit, not a rule value); the repo file's own limit is lower. */
const MAX_RULE_FILE_BYTES = 1024 * 1024;

function readRegularFileOrNull(absPath: string): string | null {
  const read = readRegularFile(absPath, MAX_WRITE_BEFORE_BYTES);
  return typeof read === 'object' ? read.text : null;
}

/**
 * Largest script file the reader reads (an expect file, K7): a read limit, not a rule value. Its
 * words then count against the call's reading budget like the command's own.
 */
const MAX_SCRIPT_FILE_BYTES = 64 * 1024;

function readScriptFile(absPath: string): string | null {
  const read = readRegularFile(absPath, MAX_SCRIPT_FILE_BYTES);
  return typeof read === 'object' ? read.text : null;
}

/** A rule file's text, null when missing; throws for anything else (see loadSettings). */
function readRuleFile(absPath: string): string | null {
  const read = readRegularFile(absPath, MAX_RULE_FILE_BYTES);
  if (read === 'missing') return null;
  if (read === 'not-regular') throw new Error('not a regular file under 1 MB');
  return read.text;
}

/** Appends a pre-call event if it can; the decision stands either way. */
function logDecision(store: StateStore, event: GateEvent): void {
  try {
    store.appendEvent(event);
  } catch {
    // The log is best effort here: a refusal must stay a refusal.
  }
}

function bashCommand(toolInput: unknown): string | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const command = (toolInput as Record<string, unknown>).command;
  return typeof command === 'string' ? command : null;
}

/** The event name for the allow-and-tell JSON: the input's own, else the mode's. */
function tellEvent(hook: HookCall | null, mode: GateMode): string {
  if (hook !== null && HOOK_EVENTS.has(hook.hookEventName)) return hook.hookEventName;
  return mode === 'pre' ? 'PreToolUse' : 'PostToolUse';
}

/** Exit 0, with the text as context for the agent (no permission decision), or nothing at all. */
function allow(hookEventName: string, context?: string): GateResult {
  if (context === undefined) return { exitCode: 0, stdout: '', stderr: '' };
  const output = { hookSpecificOutput: { hookEventName, additionalContext: context } };
  return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
}

/** A refusal, with the refused part's program (Bash only) for the log. */
interface Refused {
  refusal: Refusal;
  program?: string | null;
}

async function checkBash(ctx: Context, command: string): Promise<Refused | null> {
  const { hook, root, home, settings } = ctx;
  const facts = readCommand(command, hook.cwd, home, ctx.caseInsensitive, toplevelOf, readScriptFile, ctx.cdpath);
  if ('unreadable' in facts && facts.limit) return { refusal: tooComplex(facts.reason) };
  const tooLarge = checkCallSize(facts.parts);
  if (tooLarge !== null) return { refusal: tooLarge };
  // Once per call, not per part: the repo root and home as given and as resolved on disk.
  const { paths } = ctx;
  const places = placesOf(root, home, paths, ctx.caseInsensitive);
  const trustOf = trustForCall(repoTrust);
  for (const [index, part] of facts.parts.entries()) {
    const refusal =
      checkUnknownGitOption(part) ??
      checkPushSetup(part, facts.parts, index) ??
      checkRepoTrust(part, trustOf) ??
      checkBranchSwitch(part, facts.parts, index, settings, undefined, ctx.caseInsensitive) ??
      (await checkBranchRefs(part, settings, ctx.git, ctx.caseInsensitive)) ??
      (await checkProtectedBranch(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), ctx.caseInsensitive)) ??
      (await checkHistoryMove(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), undefined, ctx.caseInsensitive)) ??
      checkForcePush(part, settings) ??
      checkTags(part, settings) ??
      checkProductionHost(part, settings) ??
      checkProtectedPathBash(part, settings, root, home, paths, ctx.caseInsensitive, places, ctx.tree) ??
      checkGateAgentBash(part, hook.agent, settings, root, paths, ctx.caseInsensitive) ??
      (await checkGitClean(part, settings, root, home, paths, ctx.git, ctx.caseInsensitive, places, { earlier: facts.parts, count: index, tree: ctx.tree })) ??
      checkProtectedPathMention(part, settings, root, home, paths, ctx.caseInsensitive, places);
    if (refusal !== null) return { refusal, program: part.program };
  }
  if ('unreadable' in facts) {
    // ADR-010: the readable parts passed; the unreadable piece is refused only when the call is risky.
    const risky = checkUnreadable(facts.reason, facts.parts, settings, root, home, ctx.caseInsensitive);
    if (risky !== null) return { refusal: risky };
    logDecision(ctx.store, { ts: ctx.ts, tool: hook.toolName, kind: 'unreadable', result: 'allowed' });
  }
  return null;
}

/** A refusal's text for the agent: text only known when the command runs shows as `…`, never as the placeholder. */
function shown(reason: string): string {
  return reason.replaceAll(UNKNOWN, '…').replaceAll('\u0000', '');
}

function checkEdit(ctx: Context): Refused | null {
  const { hook, root, home, settings } = ctx;
  // The protected-path check needs only the file, so it runs even when the rest of the input is malformed.
  const target = readEditTarget(hook.toolName, hook.toolInput, hook.cwd, home);
  if (target === null) return null;
  const guarded = checkProtectedPathEdit(target, settings, root, home, ctx.paths, ctx.caseInsensitive);
  if (guarded !== null) return { refusal: guarded };
  const reviewed = checkGateAgentEdit(target, hook.agent, settings, root, ctx.paths, ctx.caseInsensitive);
  if (reviewed !== null) return { refusal: reviewed };
  const call = readEditCall(hook.toolName, hook.toolInput, hook.cwd, home, readRegularFileOrNull);
  if (call === null) return null;
  const refusal =
    checkFocusedTests(call, settings, root, home, ctx.caseInsensitive) ??
    checkRedCycle(call, settings, root, home, fileWorkflowState(root), ctx.store);
  return refusal === null ? null : { refusal };
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
      root: ctx.root,
      buildStartedAt: workflow?.currentCommandStartedAt ?? null,
      currentCommand: workflow?.currentCommand ?? null,
    },
  );
}

async function decide(req: GateRequest, call: Omit<Context, 'settings'>): Promise<GateResult> {
  const loaded = loadSettings(readRuleFile, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const ctx: Context = { ...call, settings: loaded.settings };
  const { hook } = ctx;
  const command = hook.toolName === 'Bash' ? bashCommand(hook.toolInput) : null;
  let refused: Refused | null = null;
  if (req.mode === 'post') {
    if (command !== null) record(ctx, command);
  } else {
    try {
      refused = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
    } catch (error) {
      // Over a per-call work limit: refused as too complex, never allowed.
      if (!(error instanceof OverBudget)) throw error;
      refused = { refusal: tooComplex(error.what) };
    }
  }
  const refusal = refused?.refusal ?? null;

  if (refused !== null) {
    logDecision(ctx.store, {
      ts: ctx.ts,
      tool: hook.toolName,
      kind: 'refusal',
      rule: refused.refusal.rule,
      ...programField(refused.program),
      result: 'refused',
    });
  }
  if (loaded.rejected !== undefined) {
    logDecision(ctx.store, {
      ts: ctx.ts,
      tool: hook.toolName,
      kind: 'rule-file-rejected',
      result: refusal !== null ? 'refused' : 'allowed',
    });
  }
  if (refusal !== null) {
    const reason = shown(refusal.reason);
    const stderr = loaded.rejected === undefined ? reason : `${reason}\n${loaded.rejected}`;
    return { exitCode: 2, stdout: '', stderr: `${stderr}\n` };
  }
  return allow(hook.hookEventName, loaded.rejected);
}

/** Logs `gate-error` where it can (best effort) and allows the call with the tell line (ADR-005). */
function failed(req: GateRequest, hook: HookCall | null, store: StateStore | null): GateResult {
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
  return allow(tellEvent(hook, req.mode), TELL);
}

/**
 * The answer when the decision itself could not finish (stopped at the hard time limit, or its
 * thread crashed): `gate-error` in the project's log, the call allowed with the tell line.
 */
export function gateErrorResult(req: GateRequest): GateResult {
  let hook: HookCall | null = null;
  let store: StateStore | null = null;
  try {
    hook = readHook(req.input);
    store = fileStateStore(projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
  } catch {
    // Unreadable input: nowhere to log, the tell line still goes out.
  }
  return failed(req, hook, store);
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
    const root = projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    store = fileStateStore(root);
    const call = {
      hook,
      root,
      home: req.env.HOME,
      store,
      git: budgetedGitReader(deps.gitReader ?? gitReaderFor(root), GIT_LIMITS),
      paths: createPathResolver(PATH_LIMITS),
      tree: createTreeFinder(TREE_LIMITS),
      ts: new Date().toISOString(),
      caseInsensitive: CASE_INSENSITIVE_PLATFORMS.has(deps.platform ?? process.platform),
      cdpath: req.env.CDPATH === '' ? undefined : req.env.CDPATH,
    };
    const now = deps.clock ?? (() => performance.now());
    const result = await Promise.race([withDeadline(DECISION_MS, now, () => decide(req, call)), timedOut]);
    if (result === null) throw new Error('tool-gate timed out');
    return result;
  } catch {
    return failed(req, hook, store);
  } finally {
    clearTimeout(timer);
  }
}
