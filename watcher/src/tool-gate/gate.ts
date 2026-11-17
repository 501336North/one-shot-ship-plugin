/**
 * The tool gate's boundary: one Claude Code hook call in, one answer out.
 *
 * - `pre` (PreToolUse): checks a Bash or edit-tool call against the rules. Allow is exit 0
 *   with no stdout (no permission decision); refuse is exit 2 with the reason on stderr. The one
 *   exception (round 8, D1/D2): a review agent's Bash call on macOS, when the sandbox passes its
 *   self-test, is allowed rewritten to run in the review sandbox (permissionDecision allow and
 *   updatedInput, sandbox.ts). A review agent's Monitor call is refused (it ignores updatedInput).
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
import { readCommand, type TrustedSources } from './command-reader.js';
import { resolveCallVariables } from './call-variables.js';
import { readEditCall, readEditTarget } from './edit-call.js';
import { budgetedGitReader, OverBudget } from './budget.js';
import { TIMED_OUT_REFUSAL, withDeadline } from './deadline.js';
import { gitReaderFor, type GitReader } from './git-reader.js';
import { createPathResolver, type PathResolver } from './path-resolver.js';
import { readRegularFile } from './regular-file.js';
import { findRepo, repoTrust } from './repo-finder.js';
import { recordTestRun } from './recorder.js';
import { createTreeFinder, type TreeFinder } from './tree-finder.js';
import { loadSettings, withUserReviewPrograms, type GateSettings } from './rule-file.js';
import { callingAgentOf } from './calling-agent.js';
import { isGateAgent, readGateAgents } from '../utils/gate-agents.js';
import { checkGateAgentBash, checkGateAgentCommand, checkGateAgentEdit, checkGateAgentUnreadable, isOwnSetupStep, offloadFolderSafe, ownAgentFile } from './rules/gate-agent-write.js';
import { checkReviewRead, READ_TOOLS } from './rules/review-read.js';
import { checkFocusedTests } from './rules/focused-tests.js';
import { checkForcePush } from './rules/force-push.js';
import { checkGitClean } from './rules/git-clean.js';
import { checkProductionHost } from './rules/production-host.js';
import { checkOssHookEnv } from './rules/oss-hook-env.js';
import { checkBranchRefs, checkBranchSwitch, checkHistoryMove, checkProtectedBranch, checkRepoTrust, trustForCall } from './rules/protected-branch.js';
import { checkProtectedPathBash, checkProtectedPathEdit, isProtected, placesOf } from './rules/protected-path.js';
import { checkCallSize, checkProtectedPathMention } from './rules/protected-path-mention.js';
import { branchCreatedBefore, checkPushSetup } from './rules/push-setup.js';
import { checkRedCycle } from './rules/red-cycle.js';
import type { Refusal } from './rules/refusal.js';
import { checkTags } from './rules/tags.js';
import { checkUnknownGitOption, checkUnreadable, tooComplex } from './rules/unreadable.js';
import { appendPrivateFile, isSafeId, mark, readPrivateFile, reviewedReposFor, runRoot, sessionFolder, sessionState } from '../gate-run/run-store.js';
import os from 'node:os';
import { OSS_PORT, privateFolder, privateFolderPath, reviewContainment, reviewUserTemp, type Containment, type SandboxRunner } from './sandbox.js';
import { readRootsProblem, withReal } from './review-places.js';
import { mountedAbove, mountedAtOrUnder, mountTable, notIn, readMountBaseline, recordMountBaseline, type MountEntry } from './mounts.js';
import { nestedRepos, type GitRun } from './nested-repos.js';
import { fileStateStore, programField, type GateEvent, type StateStore } from './state-store.js';
import { UNKNOWN } from './tokenize.js';
import { fileWorkflowState } from './workflow-state.js';

export type { GitReader };

export type GateMode = 'pre' | 'post';

export interface GateRequest {
  mode: GateMode;
  input: string;
  /** `CDPATH`: the folders `cd` searches in the shell the call runs in, when set (K8). */
  env: { HOME: string; CLAUDE_PLUGIN_ROOT: string; CLAUDE_PROJECT_DIR?: string; CDPATH?: string; TMPDIR?: string; OSS_TOOL_GATE_SANDBOX?: string };
  /**
   * The hook's whole environment, from which a sandboxed review call gets only the allowlisted,
   * non-secret names (round 9, D-R9-1); `process.env` (the hook's own) when absent.
   */
  hookEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * The plugin folder the gate itself runs from (the CLI's own location, never the environment): a
   * review agent's own setup steps are read from its agent file there.
   */
  bundleRoot?: string;
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
  /** The review sandbox's self-test and user temp folder (tests); the real ones when absent. */
  sandbox?: { run?: SandboxRunner; userTemp?: string; passwordHome?: string; settingsHomes?: readonly string[] };
  /** Runs git for the nested-repo check (round 12, D-R12-2); the real git when absent. */
  nestedGit?: GitRun;
  /** Reads the machine's mount table (null: can't be read); the real one when absent (round 13). */
  mounts?: () => readonly MountEntry[] | null;
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
  /** The Bash call was sent with `run_in_background: true`: it keeps running after the call returns. */
  background: boolean;
  /** Claude Code's session id, as given (checked where it is used). */
  sessionId: unknown;
  /** The calling subagent's id (`agent_id`), as given (checked where it is used). */
  agentId: unknown;
  /** A post call's Bash stdout (`tool_response.stdout`), when given. */
  stdout?: string;
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
  /** See GateRequest.bundleRoot. */
  bundleRoot: string | undefined;
  /** The plugin folder Claude Code names (CLAUDE_PLUGIN_ROOT). */
  pluginRoot: string;
  /** The session's temp folder (TMPDIR), if any. */
  tmpdir: string | undefined;
  /** The environment the gate sees: the reader takes a variable the call never sets from here (round 12, D-R12-1). */
  env: Readonly<Record<string, string | undefined>>;
  /** The platform the call runs on. */
  platform: NodeJS.Platform;
  /** How a review agent's Bash call is contained (round 8); null for everyone else. */
  containment: Containment | null;
  /** See GateDeps.sandbox. */
  sandboxDeps: GateDeps['sandbox'];
  /** See GateDeps.nestedGit. */
  nestedGit: GitRun | undefined;
  /** See GateDeps.mounts. */
  mounts: GateDeps['mounts'];
  /** The call's clock (GateDeps.clock): the mount table re-read is timed on it too (round 16, CR I-2). */
  clock: () => number;
  /** The mount table read before the decision's deadline started (round 14, CR LOW-2); undefined when not read. */
  mountTable: readonly MountEntry[] | null | undefined;
}

/**
 * The temp folders a review agent may write (round 6, user choice 2): /tmp, /private/tmp and the
 * session's TMPDIR as given and as it is on disk. A TMPDIR that is not absolute, or is the root, is
 * left out.
 */
function tempRoots(ctx: Pick<Context, 'tmpdir'>): string[] {
  const roots = ['/tmp', '/private/tmp'];
  const tmpdir = ctx.tmpdir;
  if (tmpdir === undefined || !path.isAbsolute(tmpdir)) return roots;
  const given = path.normalize(tmpdir).replace(/(.)\/+$/, '$1');
  let real = given;
  try {
    real = fs.realpathSync(given);
  } catch {
    // a TMPDIR that doesn't exist yet: only as given
  }
  // the home folder is never a temp folder, even inside one (the rule leaves it out)
  return given === '/' || real === '/' ? roots : [...roots, given, real];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
    background: isRecord(record.tool_input) && record.tool_input.run_in_background === true,
    sessionId: record.session_id,
    agentId: record.agent_id,
    ...(isRecord(record.tool_response) && typeof record.tool_response.stdout === 'string' ? { stdout: record.tool_response.stdout } : {}),
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
 * The repos a review agent judges: the project root, the repo holding the hook's folder (a sibling
 * worktree when the session started in the main checkout), and the repos the main agent named for
 * this session's review runs (~/.oss/gate-state/<session>/repos.json). Found only for review
 * agents, whose calls are the only ones the gate-agent-write rule checks.
 */
function reviewedRepos(ctx: Context): string[] {
  if (!isGateAgent(ctx.hook.agent, ctx.settings.gateAgents)) return [ctx.root];
  const top = toplevelOf(ctx.hook.cwd);
  let named: string[] = [];
  try {
    named = path.isAbsolute(ctx.home) ? reviewedReposFor(ctx.home, ctx.hook.sessionId) : [];
  } catch {
    // an unusable record names no more repos; the project and the hook's repo are still reviewed
  }
  return [...new Set([ctx.root, ...(top === null ? [] : [top]), ...named])];
}

/** HOME and the user's home from the password database (absolute ones only). */
function homesOf(home: string): string[] {
  return [...new Set([home, os.userInfo().homedir].filter((dir) => path.isAbsolute(dir)))];
}

/** True when the folder is the top of the repo git finds there (as it is on disk). */
function isToplevel(dir: string): boolean {
  try {
    return toplevelOf(dir) === fs.realpathSync(dir);
  } catch {
    return false;
  }
}

/**
 * The repo roots a review agent may read (round 10, SEC HIGH-1): real git toplevels only, the repo
 * holding the hook's folder, the project folder when it is itself a toplevel, and the repos the main
 * agent named for the session that are toplevels; with why they can't be used (a root that is or
 * holds a home, ~/.oss or ~/.claude), in which case every read is refused.
 */
/** The repos the main agent named for the session's review runs (any path; none when the record can't be used). */
function namedRepos(ctx: Pick<Context, 'hook' | 'home'>): string[] {
  try {
    return path.isAbsolute(ctx.home) ? reviewedReposFor(ctx.home, ctx.hook.sessionId) : [];
  } catch {
    return [];
  }
}

/** What a review call whose nested-repo check timed out is told (round 14, D-R14-2): many calls at once share the machine. */
const RETRY_ALONE = 'retry this call on its own, or with fewer calls at once';

async function readableRepos(ctx: Pick<Context, 'hook' | 'root' | 'home' | 'caseInsensitive' | 'nestedGit'>): Promise<{ repos: string[]; hidden: string[]; problem: string | null; timedOut: boolean }> {
  const top = toplevelOf(ctx.hook.cwd);
  const named = namedRepos(ctx);
  const tops = [...new Set([...(isToplevel(ctx.root) ? [ctx.root] : []), ...(top === null ? [] : [top]), ...named.filter(isToplevel)])];
  const repos = [...new Set([...tops, ...tops.flatMap(gitFoldersOf)])];
  // round 11, SEC LOW-1: the other repos and worktrees inside a readable root stay unreadable
  // round 13, D-R13-1: git is asked on every call; nothing is cached
  // once per repo on disk: the project folder as given and its toplevel are often one repo
  const hidden: string[] = [];
  for (const top of new Set(tops.map((dir) => fs.realpathSync(dir)))) {
    const repo = findRepo(top);
    const nested = repo.kind === 'repo' ? await nestedRepos(top, repo, tops, ctx.nestedGit === undefined ? {} : { run: ctx.nestedGit }) : ({ kind: 'unknown' } as const);
    // round 12, D-R12-2: a timeout says so; round 14, D-R14-2: and how to retry
    if (nested.kind === 'timeout') return { repos, hidden, problem: `the nested-repo check timed out for the reviewed repo \`${top}\`; ${RETRY_ALONE}`, timedOut: true };
    if (nested.kind === 'unknown') return { repos, hidden, problem: `git can't tell which other repos the reviewed repo \`${top}\` holds`, timedOut: false };
    hidden.push(...nested.repos);
  }
  return { repos, hidden, problem: readRootsProblem(repos, homesOf(ctx.home), ctx.caseInsensitive), timedOut: false };
}

/**
 * The git folders a repo's git commands read, as they are on disk (round 11, CR HIGH-A): `git
 * rev-parse --absolute-git-dir` and `--git-common-dir`, found as git finds them (repo-finder.ts). A
 * worktree's are in the main checkout's `.git`, a submodule's in the superproject's `.git/modules`.
 */
function gitFoldersOf(top: string): string[] {
  const repo = findRepo(top);
  if (repo.kind !== 'repo') return [];
  return [repo.gitDir, repo.commonDir].flatMap((dir) => {
    try {
      return [fs.realpathSync(dir)];
    } catch {
      return [];
    }
  });
}

/** The local ports a review agent's call may not listen on: 8473, OSS_PROXY_PORT and the user's models.proxyPort (round 10, SEC LOW-3). */
function ossPorts(home: string, env: Readonly<Record<string, string | undefined>>): number[] {
  const ports = [OSS_PORT, Number(env.OSS_PROXY_PORT)];
  try {
    const config: unknown = JSON.parse(userConfigText(home) ?? '{}');
    const models = isRecord(config) ? config.models : undefined;
    if (isRecord(models)) ports.push(Number(models.proxyPort));
  } catch {
    // no readable config: the default port and the variable still count
  }
  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536))];
}

/** The agent's private folder (made 0700), or null when it can't be made or trusted (round 10, D-R10-2). */
function ownFolder(ctx: Pick<Context, 'hook' | 'platform' | 'tmpdir' | 'sandboxDeps'>): string | null {
  const temp = reviewUserTemp(ctx.platform, ctx.tmpdir, ctx.sandboxDeps?.userTemp);
  return temp === null ? null : privateFolder(temp, ctx.hook.sessionId, ctx.hook.agentId);
}

/** The file that lists the offload folders an agent's own mktemp step made (round 11, SEC LOW-2). */
const OFFLOAD_RECORD = 'offload';
/** The offload prompt path the own mktemp step prints (`<temp>/oss-offload.XXXXXX/prompt.md`). */
const OFFLOAD_PRINTED = /^(\/[^\n]*\/oss-offload\.[A-Za-z0-9.]+)\/prompt\.md\n?$/;

/**
 * After a review agent's own offload step 1 (`mktemp -d -t oss-offload.XXXXXX`, line for line its
 * agent file's), records the folder it printed for that agent alone (round 11, SEC LOW-2), in the
 * session's ledger under ~/.oss, which no review agent can write. Best effort: nothing recorded means
 * the agent's Write of prompt.md is refused.
 */
function recordOffloadFolder(ctx: Context, command: string): void {
  const { hook } = ctx;
  const printed = OFFLOAD_PRINTED.exec(hook.stdout ?? '');
  if (printed === null || !command.includes('mktemp -d -t oss-offload.') || !isSafeId(hook.agentId) || !isSafeId(hook.sessionId)) return;
  const folder = path.normalize(printed[1] ?? '');
  const temp = tempRoots(ctx);
  if (!temp.some((root) => folder.startsWith(`${root}/`)) || !offloadFolderSafe(folder, temp) || !isOwnStep(ctx, command)) return;
  try {
    appendPrivateFile(path.join(sessionFolder(ctx.home, hook.sessionId), `${hook.agentId}.${OFFLOAD_RECORD}`), `${folder}\n`);
  } catch {
    // not recorded: the prompt.md Write is refused
  }
}

/** The offload folders the calling agent's own step made (round 11, SEC LOW-2). */
function offloadFoldersOf(ctx: Pick<Context, 'hook' | 'home'>): string[] {
  const { sessionId, agentId } = ctx.hook;
  if (!path.isAbsolute(ctx.home) || !isSafeId(agentId) || sessionState(ctx.home, sessionId) !== 'ok') return [];
  try {
    const text = readPrivateFile(path.join(runRoot(ctx.home), sessionId as string, `${agentId}.${OFFLOAD_RECORD}`));
    return text === null ? [] : text.split('\n').filter((line) => path.isAbsolute(line));
  } catch {
    return [];
  }
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

/** The user's own ~/.oss/config.json, or null when missing or not a regular file (it only adds review programs). */
function userConfigText(home: string): string | null {
  if (!path.isAbsolute(home)) return null;
  const read = readRegularFile(path.join(home, '.oss', 'config.json'), MAX_RULE_FILE_BYTES);
  return typeof read === 'object' ? read.text : null;
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

/** Largest agent file read for a review agent's setup steps (a read limit, not a rule value). */
const MAX_AGENT_FILE_BYTES = 256 * 1024;

/** The plugin scripts the setup steps run, under `<plugin>/watcher/dist/cli/`. */
const SETUP_SCRIPTS = ['agent-model-check.js', 'agent-offload.js'];

/**
 * True when a review agent's call is one of its own setup steps (see isOwnSetupStep), read from the
 * agent file in the folder the gate runs from, and the plugin scripts those steps run, where they
 * exist, really are that folder's (CLAUDE_PLUGIN_ROOT, or the ~/.claude/plugins/oss fallback).
 */
function isOwnStep(ctx: Context, command: string): boolean {
  const file = ownAgentFile(ctx.hook.agent);
  if (file === null || ctx.bundleRoot === undefined || !path.isAbsolute(ctx.bundleRoot)) return false;
  const read = readRegularFile(path.join(ctx.bundleRoot, 'agents', file), MAX_AGENT_FILE_BYTES);
  const temp = tempRoots(ctx);
  if (typeof read !== 'object' || !isOwnSetupStep(command, read.text, temp, [...reviewedRepos(ctx), ctx.home], (folder) => offloadFolderSafe(folder, temp))) return false;
  try {
    const own = fs.realpathSync(ctx.bundleRoot);
    const roots = [ctx.pluginRoot, path.join(ctx.home, '.claude', 'plugins', 'oss')].filter((root) => path.isAbsolute(root));
    return roots.every((root) =>
      SETUP_SCRIPTS.every((script) => {
        const at = path.join(root, 'watcher', 'dist', 'cli', script);
        return !fs.existsSync(at) || fs.realpathSync(at).startsWith(`${own}${path.sep}`);
      }),
    );
  } catch {
    return false;
  }
}

/**
 * The plugin folder a call's `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}` names, when that is
 * the folder the gate runs from (on disk); null otherwise, so the call's variables stay unknown.
 */
function trustedPluginRoot(ctx: Context): string | null {
  if (ctx.bundleRoot === undefined || !path.isAbsolute(ctx.bundleRoot)) return null;
  const installed = path.join(ctx.home, '.claude', 'plugins', 'oss');
  const named = ctx.pluginRoot !== '' ? ctx.pluginRoot : installed;
  if (!path.isAbsolute(named) || !path.isAbsolute(installed)) return null;
  try {
    const own = fs.realpathSync(ctx.bundleRoot);
    // the shell that runs the call may see either place: both must be this folder (the installed one may be missing)
    const installedOk = !fs.existsSync(installed) || fs.realpathSync(installed) === own;
    return fs.realpathSync(named) === own && installedOk ? own : null;
  } catch {
    return null;
  }
}

/**
 * True when the plugin folder lies in a repo this session writes or reviews (round 12, CR L1): its
 * hook files are then the agent's to change, so sourcing one may move the shell. Unreadable: in one.
 */
function pluginInRepo(ctx: Context): boolean {
  try {
    const plugin = fs.realpathSync(ctx.pluginRoot);
    return [ctx.root, ...reviewedRepos(ctx)].some((repo) => {
      const real = fs.realpathSync(repo);
      return plugin === real || plugin.startsWith(`${real}${path.sep}`);
    });
  } catch {
    return true;
  }
}

/**
 * True when the plugin's hook files are protected paths (round 13, CR L-d): the plugin folder is
 * under ~/.claude/plugins or another protected path, as written and as it is on disk, the data-volume
 * firmlink taken off. A plugin folder anywhere else is not OSS's own.
 */
function pluginProtected(ctx: Context): boolean {
  try {
    const hookFile = path.join(fs.realpathSync(ctx.pluginRoot), 'hooks', 'oss-hook.sh');
    return isProtected(hookFile, ctx.settings, placesOf(ctx.root, ctx.home, ctx.paths, ctx.caseInsensitive), ctx.paths);
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return false;
  }
}

/**
 * OSS's own hook folders, whose files a `source` / `.` may run without the folder becoming unknown:
 * `~/.oss/hooks` in each home, and the plugin's `hooks` (R-266 round 11) when the plugin folder is
 * protected and not in a repo the session writes or reviews (round 13, CR L-d).
 */
function trustedSourcesOf(ctx: Context): TrustedSources {
  const plugin = path.isAbsolute(ctx.pluginRoot) && pluginProtected(ctx) && !pluginInRepo(ctx) ? [path.join(ctx.pluginRoot, 'hooks')] : [];
  return { folders: [...homesOf(ctx.home).map((home) => path.join(home, '.oss', 'hooks')), ...plugin], pluginRootVariable: plugin.length > 0 };
}

/**
 * The call as the reader reads it: a builder's or the main agent's own simple variables filled in
 * (never a review agent's); the call as it is when filling in fails for any reason but the deadline.
 */
function withCallVariables(ctx: Context, command: string): string {
  if (!command.includes('$') || isGateAgent(ctx.hook.agent, ctx.settings.gateAgents)) return command;
  try {
    return resolveCallVariables(command, ctx.home, trustedPluginRoot(ctx));
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return command;
  }
}

async function checkBash(ctx: Context, command: string): Promise<Refused | null> {
  const { hook, root, home, settings } = ctx;
  const read = withCallVariables(ctx, command);
  // the command's own variables (and the environment's) are followed, never a review agent's (round 12, CR L4)
  const follow = !isGateAgent(hook.agent, settings.gateAgents);
  const facts = readCommand(read, hook.cwd, home, ctx.caseInsensitive, toplevelOf, readScriptFile, ctx.cdpath, follow, trustedSourcesOf(ctx), ctx.env);
  if ('unreadable' in facts && facts.limit) return { refusal: tooComplex(facts.reason) };
  // a review agent's call is read whole: no unreadable piece, no loop setting a risky variable;
  // its own setup steps, exactly as its agent file writes them, are the one exception
  const ownStep = isOwnStep(ctx, command);
  const reviewer = ownStep ? null : ('unreadable' in facts ? checkGateAgentUnreadable(hook.agent, settings, facts.reason) : null) ?? checkGateAgentCommand(hook.agent, settings, command);
  if (reviewer !== null) return { refusal: reviewer };
  const tooLarge = checkCallSize(facts.parts);
  if (tooLarge !== null) return { refusal: tooLarge };
  // Once per call, not per part: the repo root and home as given and as resolved on disk.
  const { paths } = ctx;
  const places = placesOf(root, home, paths, ctx.caseInsensitive);
  const trustOf = trustForCall(repoTrust);
  const repos = reviewedRepos(ctx);
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
      checkOssHookEnv(part, command) ??
      checkProtectedPathBash(part, settings, root, home, paths, ctx.caseInsensitive, places, ctx.tree) ??
      (ownStep ? null : checkGateAgentBash(part, hook.agent, settings, { repos, home, exists: fs.existsSync, temp: tempRoots(ctx), fallback: ctx.containment?.kind === 'fallback', darwin: ctx.platform === 'darwin', sandboxed: ctx.containment?.kind === 'sandbox' }, paths, ctx.caseInsensitive, { earlier: facts.parts.slice(0, index), background: hook.background })) ??
      (await checkGitClean(part, settings, root, home, paths, ctx.git, ctx.caseInsensitive, places, { earlier: facts.parts, count: index, tree: ctx.tree })) ??
      checkProtectedPathMention(part, settings, root, home, paths, ctx.caseInsensitive, places);
    if (refusal !== null) return { refusal, program: part.program };
  }
  if ('unreadable' in facts && !ownStep) {
    // ADR-010: the readable parts passed; the unreadable piece is refused only when the call is risky
    // (a review agent's own setup step is the plugin's own text: what it runs is known).
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
  const reviewer = isGateAgent(hook.agent, settings.gateAgents);
  const reviewed = checkGateAgentEdit(target, hook.agent, settings, { repos: reviewedRepos(ctx), home, exists: fs.existsSync, temp: tempRoots(ctx), privateDir: reviewer ? ownFolder(ctx) : null, offloadFolders: reviewer ? offloadFoldersOf(ctx) : [] }, ctx.paths, ctx.caseInsensitive);
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

/**
 * True for a Monitor call: by name, or arriving as Bash with Monitor's own fields (`timeout_ms`,
 * `ws`). Monitor ignores a rewritten input, so a review agent's would run outside the sandbox.
 */
function isMonitorCall(hook: HookCall): boolean {
  if (hook.toolName === 'Monitor') return true;
  return hook.toolName === 'Bash' && isRecord(hook.toolInput) && ('timeout_ms' in hook.toolInput || 'ws' in hook.toolInput);
}

const MONITOR_REFUSED: Refusal = {
  rule: 'gate-agent-write',
  reason:
    'Refused by gate-agent-write: a review agent may not use the Monitor tool (it runs outside the review sandbox). Run the check as a Bash call that ends, or report what you need to the main agent.',
};

/** The refusal when a review agent's Bash call can't be put in the sandbox on macOS (round 9, D-R9-1, SEC INFO-2). */
function uncontained(reason: string): Refusal {
  return {
    rule: 'gate-agent-write',
    reason: `Refused by gate-agent-write: ${reason}. Run nothing for now and report what you need to the main agent; the user can check that /usr/bin/sandbox-exec works and that the reviewed repo and HOME are not inside the review sandbox's private temp folder.`,
  };
}

/**
 * A review agent's Bash call that passed the rules: its tool input rewritten to run in the sandbox
 * (every other field kept), null to run it as it is (its own setup step, or the fallback rules held
 * it), or a refusal: on macOS it runs sandboxed or not at all (round 9, SEC INFO-2).
 */
async function containedInput(ctx: Context, command: string): Promise<{ input: Record<string, unknown> } | Refused | null> {
  const { containment, hook } = ctx;
  if (containment === null || isOwnStep(ctx, command)) return null;
  if (containment.kind === 'refused') return { refusal: uncontained(containment.reason) };
  if (containment.kind === 'fallback') {
    // round 9, SEC INFO-3: a call held only by the fallback rules is logged
    logDecision(ctx.store, { ts: ctx.ts, tool: hook.toolName, kind: 'review-fallback', result: 'allowed' });
    return null;
  }
  const readable = await readableRepos(ctx);
  // round 14, D-R14-2: a timeout is no sandbox problem: no sandbox-exec advice
  if (readable.timedOut) return { refusal: { rule: 'gate-agent-write', reason: `Refused by gate-agent-write: ${readable.problem ?? ''}.` } };
  if (readable.problem !== null) return { refusal: uncontained(`the review sandbox can't open the reviewed repos: ${readable.problem}`) };
  const wrapped = isRecord(hook.toolInput) ? containment.wrap(command, readable.repos, readable.hidden) : null;
  if (wrapped === null || !isRecord(hook.toolInput)) return { refusal: uncontained("a reviewed repo or HOME is inside the review sandbox's private folder, so the sandbox can't keep it read-only") };
  return { input: { ...hook.toolInput, command: wrapped } };
}

/**
 * The most a review call waits for the mount table (round 13, PERF LOW-2): its own limit, read
 * before the decision's deadline starts (round 14, CR LOW-2), so slow work can't leave it no time and
 * a slow read can't use up the decision's. Round 15 (CR I3 / PERF INFO-2): with the decision's
 * DECISION_MS and node's start, it fits under the CLI's 2.5 s HARD_LIMIT_MS; a read that took longer
 * counts as unreadable.
 */
const MOUNT_TABLE_MS = 1200;

/**
 * The places a mount at or under voids a review (round 13, CR L-c; round 14, SEC CRITICAL-1, CR
 * INFO-1): the repo top folders (the project folder, the cwd's repo and the named repos; each one
 * that is a toplevel, or that a mount sits exactly on, since a mount over a root hides its `.git`),
 * their git folders, the agent's private folder, and the places a mount could hide to turn the gate
 * off: ~/.claude (plugins and settings), ~/.oss and the plugin root in use; as given and as they are on
 * disk. No nested-repo check: no git.
 */
function mountPlaces(ctx: Context, table: readonly MountEntry[]): { watched: string[]; above: string[] } {
  const mountedOn = new Set(table.map((entry) => entry.at));
  const top = toplevelOf(ctx.hook.cwd);
  const candidates = withReal([ctx.root, ...(top === null ? [] : [top]), ...namedRepos(ctx)].filter((dir) => path.isAbsolute(dir) && dir !== path.parse(dir).root));
  const roots = candidates.filter((dir) => mountedOn.has(dir) || isToplevel(dir));
  const temp = reviewUserTemp(ctx.platform, ctx.tmpdir, ctx.sandboxDeps?.userTemp);
  const own = temp === null ? [] : [privateFolderPath(temp, ctx.hook.sessionId, ctx.hook.agentId)];
  const gate = [...(path.isAbsolute(ctx.home) ? [path.join(ctx.home, '.claude'), path.join(ctx.home, '.oss')] : []), ctx.pluginRoot, ...(ctx.bundleRoot === undefined ? [] : [ctx.bundleRoot])];
  const fixed = [...own, ...gate.filter((dir) => path.isAbsolute(dir) && dir !== path.parse(dir).root)];
  // round 15, CR L3 (checked on Linux only, D-R15-2): above, every candidate root counts, even one a mount above has hidden (no longer a repo)
  return { watched: withReal([...roots, ...roots.flatMap(gitFoldersOf), ...fixed]), above: withReal([...candidates, ...fixed]) };
}

/** The machine's mount table (the seam in tests), read the way the host OS keeps it; null when unreadable. */
function readMountTable(mounts: GateDeps['mounts'], now: () => number): readonly MountEntry[] | null {
  try {
    const start = now();
    const table = mounts !== undefined ? mounts() : mountTable(process.platform, MOUNT_TABLE_MS);
    return now() - start > MOUNT_TABLE_MS ? null : table;
  } catch {
    return null;
  }
}

/** Voids the calling review agent's run (its tamper mark), best effort. */
function voidRun(ctx: Pick<Context, 'hook' | 'home'>): void {
  const { sessionId, agentId } = ctx.hook;
  try {
    if (isSafeId(sessionId) && isSafeId(agentId) && path.isAbsolute(ctx.home)) mark(ctx.home, sessionId, agentId, 'tamper');
  } catch {
    // best effort: the refusal still tells the agent and the main agent
  }
}

const refusedFor = (what: string): Refused => ({ refusal: { rule: 'gate-agent-write', reason: `Refused by gate-agent-write: ${what}` } });

/**
 * The mount backstop, on each of a review agent's calls (round 12, SEC CRITICAL-A; round 14, SEC
 * CRITICAL-1: before each call too, not only after a Bash call). A mount at or under a watched place
 * (mountPlaces) refuses the call and voids the run (its tamper mark). On macOS every such mount counts
 * (D-R14-1); a mount above one is not checked there (D-R15-2, accepted limit: the review sandbox's
 * mount deny is the defence). On Linux only the change from the agent's baseline, at, under or above
 * (round 15, CR L3), recorded on its first call: a mount added (stacked, or another device at a path) or one gone (CR LOW-4 / SEC LOW-1). A table that can't
 * be read, or places that can't be worked out, void the run after a call; before one, the call is
 * refused (try again) unless something was found.
 */
function mountRefusal(ctx: Context, mode: GateMode): Refused | null {
  const table = ctx.mountTable !== undefined ? ctx.mountTable : readMountTable(ctx.mounts, ctx.clock);
  const linux = ctx.platform === 'linux';
  if (table === null) {
    if (mode === 'post') voidRun(ctx);
    return refusedFor(
      mode === 'post'
        ? "the gate couldn't read the mount table after your call, so it can't tell whether the code under review was swapped; this review is void. Stop and report this to the main agent."
        : "the gate couldn't read the mount table, which it needs before a review agent's call so it can tell whether anything was mounted over the code under review or the gate. Try again, or report this to the main agent.",
    );
  }
  if (linux && mode === 'pre') {
    try {
      recordMountBaseline(ctx.home, ctx.hook.sessionId, ctx.hook.agentId, table);
    } catch {
      return refusedFor("the gate couldn't record the mount table in its state under ~/.oss/gate-state, which it needs before a review agent's call so it can tell later whether anything was mounted over the code under review. Try again, or report this to the main agent.");
    }
  }
  const baseline = !linux ? [] : path.isAbsolute(ctx.home) ? readMountBaseline(ctx.home, ctx.hook.sessionId, ctx.hook.agentId) : null;
  let found: MountEntry[] | null;
  try {
    const places = mountPlaces(ctx, table);
    const added = baseline === null ? [] : notIn(table, baseline);
    const gone = baseline === null ? [] : notIn(baseline, table);
    found =
      baseline === null
        ? null
        : [...mountedAtOrUnder(added, places.watched), ...mountedAtOrUnder(gone, places.watched), ...(linux ? mountedAbove([...added, ...gone], places.above) : [])];
  } catch {
    found = null;
  }
  if (found !== null && found.length === 0) return null;
  voidRun(ctx);
  const what =
    found === null
      ? baseline === null
        ? "the gate has no mount baseline from before your calls, so it can't tell whether the code under review was swapped"
        : "the gate couldn't work out which places to check for mounts, so it can't tell whether the code under review was swapped"
      : `a file system was mounted or unmounted ${linux ? 'at, under or above' : 'at or under'} the reviewed repo, your private folder or the gate's own folders (\`${found[0]?.at ?? ''}\`), so the code under review or the gate may have been swapped`;
  return refusedFor(`${what}; this review is void. Stop and report this to the main agent.`);
}

async function decide(req: GateRequest, call: Omit<Context, 'settings' | 'containment'>): Promise<GateResult> {
  const loaded = loadSettings(readRuleFile, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const settings = withUserReviewPrograms(loaded.settings, userConfigText(call.home));
  const { hook } = call;
  const command = hook.toolName === 'Bash' ? bashCommand(hook.toolInput) : null;
  const reviewer = req.mode === 'pre' && isGateAgent(hook.agent, settings.gateAgents);
  const containment =
    reviewer && command !== null
      ? reviewContainment(
          {
            platform: call.platform,
            home: call.home,
            sessionId: hook.sessionId,
            env: req.hookEnv ?? process.env,
            agentId: hook.agentId,
            ...(call.tmpdir === undefined ? {} : { tmpdir: call.tmpdir }),
            ports: ossPorts(call.home, req.hookEnv ?? process.env),
            toolInput: hook.toolInput,
            disabled: req.env.OSS_TOOL_GATE_SANDBOX === 'off',
            ...(call.sandboxDeps?.userTemp === undefined ? {} : { userTemp: call.sandboxDeps.userTemp }),
            ...(call.sandboxDeps?.passwordHome === undefined ? {} : { passwordHome: call.sandboxDeps.passwordHome }),
            ...(call.sandboxDeps?.settingsHomes === undefined ? {} : { settingsHomes: call.sandboxDeps.settingsHomes }),
          },
          call.sandboxDeps?.run,
        )
      : null;
  const ctx: Context = { ...call, settings, containment };
  let refused: Refused | null = null;
  const reviewCall = command !== null && isGateAgent(hook.agent, settings.gateAgents);
  // round 14, SEC CRITICAL-1: the mount backstop on each review call, before and after, first of all
  const mounted = reviewer || (req.mode === 'post' && reviewCall) ? mountRefusal(ctx, req.mode) : null;
  if (req.mode === 'post') {
    refused = mounted;
    if (command !== null) record(ctx, command);
    if (reviewCall && command !== null) recordOffloadFolder(ctx, command);
  } else if (mounted !== null) {
    refused = mounted;
  } else if (reviewer && isMonitorCall(hook)) {
    refused = { refusal: MONITOR_REFUSED };
  } else if (reviewer && READ_TOOLS.has(hook.toolName)) {
    const readable = await readableRepos(call);
    const read = checkReviewRead(hook.toolName, hook.toolInput, hook.cwd, { homes: homesOf(call.home), repos: readable.repos, hidden: readable.hidden, problem: readable.problem, privateDir: ownFolder(call), ...(call.tmpdir === undefined ? {} : { tmpdir: call.tmpdir }) }, call.caseInsensitive);
    refused = read === null ? null : { refusal: read };
  } else {
    try {
      refused = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
    } catch (error) {
      // Over a per-call work limit: refused as too complex, never allowed.
      if (!(error instanceof OverBudget)) throw error;
      refused = { refusal: tooComplex(error.what) };
    }
  }
  const contained = refused === null && reviewer && command !== null ? await containedInput(ctx, command) : null;
  if (contained !== null && 'refusal' in contained) refused = contained;
  const updatedInput = contained !== null && 'input' in contained ? contained.input : null;
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
  if (updatedInput !== null) {
    // D2: the wrapped call runs without a prompt (the user's own Bash rules no longer match its text)
    // round 10, CR MEDIUM-3: the agent learns where a sandbox refusal comes from
    const context = loaded.rejected === undefined ? IN_SANDBOX : `${IN_SANDBOX}\n${loaded.rejected}`;
    const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput, additionalContext: context } };
    return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
  }
  // a review agent's Bash call allowed as it is (its own setup step, or the fallback rules): the one
  // fixed note the hook accepts in place of a rewrite on macOS (SEC INFO-1); nothing is added to it
  if (reviewer && command !== null) return OUTSIDE_SANDBOX_ALLOW;
  return allow(hook.hookEventName, loaded.rejected);
}

/**
 * The one note a review agent's Bash call allowed outside the review sandbox carries, as its whole
 * additionalContext (round 10). hooks/oss-tool-gate.sh accepts it on macOS only as the entire answer,
 * so no text from a command or a path may ever be added to it.
 */
export const OUTSIDE_SANDBOX_NOTE = 'This command runs outside the review sandbox.';
const OUTSIDE_SANDBOX_ALLOW: GateResult = {
  exitCode: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: OUTSIDE_SANDBOX_NOTE } })}\n`,
  stderr: '',
};

/** The context a sandboxed call is allowed with (round 10, CR MEDIUM-3). */
export const IN_SANDBOX =
  "This command runs in the review sandbox: 'Operation not permitted' under your home or outside $TMPDIR comes from the sandbox, not from the code under review.";

/** The refusal a review agent gets when its call could not be checked (round 6, user choice 1). */
const UNCHECKED_REVIEW =
  "Refused by gate-agent-write: the gate could not finish checking this review agent's call (it timed out or failed), and a review agent's call that can't be checked is refused. Write the command more simply, or report what you need to the main agent.\n";

/**
 * True when the caller is a review agent, by the plugin's gateAgents (CLAUDE_PLUGIN_ROOT, else the
 * folder the gate runs from); a named agent counts as one when neither list can be read.
 */
function reviewerOrUnknown(req: GateRequest, hook: HookCall | null): boolean {
  if (hook === null || hook.agent === undefined) return false;
  for (const root of [req.env.CLAUDE_PLUGIN_ROOT, req.bundleRoot]) {
    if (root === undefined || !path.isAbsolute(root)) continue;
    try {
      return isGateAgent(hook.agent, readGateAgents(root, projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd)));
    } catch {
      // this list can't be read: try the next
    }
  }
  return true;
}

/**
 * Logs `gate-error` where it can (best effort). A builder's or the main agent's call is allowed
 * with the tell line (ADR-005); a review agent's is refused, since an unchecked review call could
 * change what it judges (round 6, user choice 1).
 */
function failed(req: GateRequest, hook: HookCall | null, store: StateStore | null, timedOut = false): GateResult {
  // round 13, SEC INFO-2: a review agent's post call that could not finish never read the mount table: void the run
  if (req.mode === 'post' && hook !== null && reviewerOrUnknown(req, hook)) voidRun({ hook, home: req.env.HOME });
  const reviewer = req.mode === 'pre' && reviewerOrUnknown(req, hook);
  // round 9, D-R9-4: a builder's or the main agent's call past its time is refused, not let through
  const late = !reviewer && timedOut && req.mode === 'pre';
  try {
    store?.appendEvent({
      ts: new Date().toISOString(),
      tool: hook?.toolName ?? 'unknown',
      kind: 'gate-error',
      result: reviewer || late ? 'refused' : 'allowed',
    });
  } catch {
    // Logging is best effort; the answer is the same either way.
  }
  if (reviewer) return { exitCode: 2, stdout: '', stderr: UNCHECKED_REVIEW };
  if (late) return { exitCode: 2, stdout: '', stderr: TIMED_OUT_REFUSAL };
  return allow(tellEvent(hook, req.mode), TELL);
}

/**
 * The answer when the decision itself could not finish (stopped at the hard time limit, or its
 * thread crashed): `gate-error` in the project's log, the call allowed with the tell line.
 */
export function gateErrorResult(req: GateRequest, timedOut = false): GateResult {
  let hook: HookCall | null = null;
  let store: StateStore | null = null;
  try {
    hook = readHook(req.input);
    store = fileStateStore(projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
  } catch {
    // Unreadable input: nowhere to log, the tell line still goes out.
  }
  return failed(req, hook, store, timedOut);
}

export async function runToolGate(req: GateRequest, deps: GateDeps = {}): Promise<GateResult> {
  let hook: HookCall | null = null;
  let store: StateStore | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let late = false;
  try {
    hook = readHook(req.input);
    const root = projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    store = fileStateStore(root);
    // round 14, CR LOW-2: a review call's mount table is read before its time starts, on its own limit
    const now = deps.clock ?? (() => performance.now());
    const mountTable = reviewerOrUnknown(req, hook) && (req.mode === 'pre' || hook.toolName === 'Bash') ? readMountTable(deps.mounts, now) : undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });
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
      bundleRoot: req.bundleRoot,
      pluginRoot: req.env.CLAUDE_PLUGIN_ROOT,
      tmpdir: req.env.TMPDIR === '' ? undefined : req.env.TMPDIR,
      env: req.hookEnv ?? process.env,
      platform: deps.platform ?? process.platform,
      sandboxDeps: deps.sandbox,
      nestedGit: deps.nestedGit,
      mounts: deps.mounts,
      clock: now,
      mountTable,
    };
    const result = await Promise.race([withDeadline(DECISION_MS, now, () => decide(req, call)), timedOut]);
    if (result === null) {
      late = true;
      throw new Error('tool-gate timed out');
    }
    return result;
  } catch {
    return failed(req, hook, store, late);
  } finally {
    clearTimeout(timer);
  }
}
