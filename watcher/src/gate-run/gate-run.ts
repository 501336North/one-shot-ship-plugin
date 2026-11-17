/**
 * Gate-run check (R-266, US-008, ADR-007, ADR-009, ADR-011): a review (gate) agent's run is checked for
 * any repo change. Called by hooks/oss-gate-run.sh (through dist/cli/gate-run.cjs) with the hook JSON:
 *   subagent-start  SubagentStart: for a gate agent, fingerprint every repo in play (fingerprint.ts) and
 *                   keep it in ~/.oss/gate-state/<session_id>/<agent_id>.snap.json (run-store.ts).
 *   subagent-stop   SubagentStop: compare; then drop the snapshot.
 *   agent-post      the `Agent` PostToolUse: the notice kept for `tool_response.agentId`, to the main agent.
 *   main-post       any PostToolUse: for the main agent's calls (no agent_id), every notice pending for
 *                   the session, to the main agent. This is how a background run's outcome reaches it.
 *   add-repo        `oss-gate-run.sh add-repo`: the main agent names one more repo for this session's
 *                   review runs, in the value file <session>/repo-request.txt (CLAUDE_CODE_SESSION_ID).
 *
 * Whether the agent is a gate agent is decided first, before any git call: any other agent is never
 * checked and never told anything, in a repo or not. For a gate agent every outcome but "checked, no
 * change" is told to the user (systemMessage) and kept as a notice for the main agent: void (what
 * changed) or unverified (why: no snapshot, not a repo, an error, out of time). A start that could not
 * snapshot is told at once and recorded; its stop says unverified again (never silent). Always exit 0;
 * an unverified run logs one gate-error line in the repo's tool-gate event log where it can.
 *
 * The check's own records are checked, not trusted (ship round 2; a review agent runs code as the user,
 * so this raises the bar, it cannot make forging impossible: recorded limit). Each run keeps a ledger
 * (run-store.ts): `started` at its start, `start-failed` when its start could not snapshot, `tamper`,
 * `done` after its stop; and the session's ledger of every agent id it started (agents.seen). A review
 * agent continued with SendMessage fires SubagentStart and SubagentStop again with the same agent id
 * (probe, round 3): a start after `done` (no tamper) is a new segment, checked on its own. A start for
 * a run that started and has not ended, or whose marks are gone but which the ledger has seen, a stop
 * for a run already done, a snapshot record that does not validate, and a notice for a run the ledger
 * does not know are all tampering: unverified, never silent. A record saying "unverified" is always
 * unverified at stop. The `Agent` result of a foreground run whose stop never finished (started, not
 * done) is unverified too.
 *
 * The user-level files that steer the gate (user-files.ts: the gate and model keys of
 * ~/.oss/config.json, the hook, env and plugin keys of the Claude settings, installed_plugins.json, the
 * OSS hooks and bin, this session's repos.json, the gate parts of the installed and running OSS plugin,
 * the node the hooks run and PATH's shadows of it) are fingerprinted with the repos and compared at
 * stop; a change there voids the run too, named `(user) <name>`. A record without them was written by
 * an older plugin: unverified, the check changed version during the run.
 *
 * The repos: the one holding CLAUDE_PROJECT_DIR (when it is an existing absolute folder), the one
 * holding the hook's cwd, and any the main agent named (add-repo), each once. The whole run gets a 7 s
 * budget (the hook timeout is 10 s).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GateEvent } from '../tool-gate/state-store.js';
import { isGateAgent, readGateAgents } from '../utils/gate-agents.js';
import { changesSince, isRepoPrint, printRepo, type RepoPrint } from './fingerprint.js';
import { printUserFiles, userChanges, type UserContext } from './user-files.js';
import { BudgetExceeded, git, gitOrNull, type Budget } from './git.js';
import { gitBinary } from './git-bin.js';
import { REASONS, noticeMessage, unverifiedMessage, voidMessage } from './messages.js';
import {
  addReviewedRepo,
  appendPrivateFile,
  clearMark,
  hasMark,
  isKnownReason,
  isSafeId,
  mark,
  markSeen,
  readPrivateFile,
  reviewedReposFor,
  sessionFolder,
  sessionState,
  storeNotice,
  sweepRunFolder,
  takeNotices,
  takePrivateFile,
  wasSeen,
  writePrivateFile,
  type TakenNotices,
} from './run-store.js';

export type GateRunEvent = 'subagent-start' | 'subagent-stop' | 'agent-post' | 'main-post' | 'add-repo';

export interface GateRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GateRunRequest {
  event: GateRunEvent;
  input: string;
  env: {
    HOME: string;
    CLAUDE_PLUGIN_ROOT: string;
    CLAUDE_PROJECT_DIR?: string;
    CLAUDE_CODE_SESSION_ID?: string;
    CLAUDE_CONFIG_DIR?: string;
    PATH?: string;
  };
  /** The plugin root the running CLI was bundled in (its gate parts are fingerprinted too). */
  bundleRoot?: string;
  /** When the check must be done (ms since the epoch); default 7 s from now. */
  deadline?: number;
}

/** What the user is told when the check itself fails before it knows the run: the review stands, unverified. */
export const CHECK_FAILED =
  'OSS review check could not run, so this review run is unverified: the repo may have changed while it ran.';

const BUDGET_MS = 7000;
const MAX_STORED_PATHS = 200;
const SILENT: GateRunResult = { exitCode: 0, stdout: '', stderr: '' };

type SnapRecord =
  | { repos: Array<{ top: string; print: RepoPrint }>; user: Record<string, string>; startedAt: number }
  | { unverified: string };

interface GateRun {
  home: string;
  sessionId: string;
  agentId: string;
  folders: string[];
  budget: Budget;
  user: UserContext;
}

function say(output: object): GateRunResult {
  return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
}

function isFolder(dir: unknown): dir is string {
  return typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** CLAUDE_PROJECT_DIR and the hook's cwd, when each is an existing absolute folder, each once. */
function candidateFolders(projectDir: string | undefined, cwd: unknown): string[] {
  return [...new Set([projectDir, cwd].filter(isFolder))];
}

/** The nearest folder at or above `dir` holding `.git` (no git call); null when none. */
function nearestRepoFolder(dir: string): string | null {
  let current = dir;
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The plugin's gate agents plus any each candidate repo's .oss/tool-gates.json adds. Throws when the plugin list is unreadable. */
function gateAgentsFor(pluginRoot: string, folders: string[]): string[] {
  const roots = folders.length > 0 ? folders.map((folder) => nearestRepoFolder(folder) ?? folder) : [pluginRoot];
  return [...new Set(roots.flatMap((root) => readGateAgents(pluginRoot, root)))];
}

/**
 * Logs `gate-error` in the tool-gate event log (<repo>/.oss/tool-gates/events.ndjson) of the first repo
 * found (best effort, no git call). Never through a symlinked folder or into one outside the repo, and a
 * FIFO or anything but a regular file at the log's path is skipped, never waited on (security HIGH-2).
 */
function logGateError(folders: string[]): void {
  try {
    const top = folders.map(nearestRepoFolder).find((dir): dir is string => dir !== null);
    if (top === undefined) return;
    const ossDir = path.join(top, '.oss');
    const logDir = path.join(ossDir, 'tool-gates');
    if ([ossDir, logDir].some((dir) => fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink() === true)) return;
    fs.mkdirSync(logDir, { recursive: true });
    if (!fs.realpathSync(logDir).startsWith(`${fs.realpathSync(top)}${path.sep}`)) return;
    const event: GateEvent = { ts: new Date().toISOString(), tool: 'gate-run', kind: 'gate-error', result: 'allowed' };
    appendPrivateFile(path.join(logDir, 'events.ndjson'), `${JSON.stringify(event)}\n`);
  } catch {
    // Nowhere to log: the user and the main agent are still told.
  }
}

/** An unverified run: kept for the main agent, logged, told to the user. */
function unverified(run: GateRun, reason: string): GateRunResult {
  try {
    storeNotice(run.home, run.sessionId, run.agentId, { kind: 'unverified', reason });
  } catch {
    // The user is still told.
  }
  logGateError(run.folders);
  return say({ systemMessage: unverifiedMessage(reason) });
}

/** The distinct repo tops holding the folders. */
function repoTops(folders: string[], budget: Budget): string[] {
  gitBinary();
  const tops = new Set<string>();
  for (const folder of folders) {
    try {
      tops.add(git(folder, ['rev-parse', '--show-toplevel'], budget).trim());
    } catch (err) {
      if (err instanceof BudgetExceeded) throw err;
    }
  }
  return [...tops];
}

function snapFile(run: GateRun): string {
  return path.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.snap.json`);
}

/** The run's own folder for its temporary files (index, excludes, object copy), made empty and private. */
function freshRunDir(run: GateRun): string {
  const dir = path.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.run`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

function runDirOf(run: GateRun): string {
  return path.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.run`);
}

function reasonOf(err: unknown, otherwise: string): string {
  return err instanceof BudgetExceeded ? REASONS.timeout : otherwise;
}

/** A snapshot record read back, checked; null when it does not validate, `old` when an older plugin wrote it. */
function parseRecord(text: string): SnapRecord | 'old' | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.unverified === 'string' && Object.keys(record).length === 1) return { unverified: record.unverified };
  const { repos, user, startedAt } = record;
  if (!Array.isArray(repos) || repos.length === 0) return null;
  const valid = repos.every((repo: unknown) => {
    const entry = repo as { top?: unknown; print?: unknown } | null;
    return typeof entry?.top === 'string' && path.isAbsolute(entry.top) && isRepoPrint(entry.print);
  });
  if (!valid) return null;
  if (user === undefined || startedAt === undefined) return 'old';
  const userValid = typeof user === 'object' && user !== null && !Array.isArray(user) && Object.values(user).every((v) => typeof v === 'string');
  if (!userValid || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return { repos: repos as Array<{ top: string; print: RepoPrint }>, user: user as Record<string, string>, startedAt };
}

async function onStart(run: GateRun): Promise<GateRunResult> {
  sweepRunFolder(run.home, Date.now());
  let file: string;
  try {
    file = snapFile(run);
  } catch {
    return unverified(run, REASONS.recordsUnusable);
  }
  const { home, sessionId, agentId } = run;
  const started = hasMark(home, sessionId, agentId, 'started');
  const done = hasMark(home, sessionId, agentId, 'done');
  const replayed =
    hasMark(home, sessionId, agentId, 'tamper') ||
    fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined ||
    (started && !done) ||
    (!started && !done && wasSeen(home, sessionId, agentId));
  if (replayed) {
    mark(home, sessionId, agentId, 'tamper');
    return unverified(run, REASONS.tampered);
  }
  clearMark(home, sessionId, agentId, 'done');
  mark(home, sessionId, agentId, 'started');
  markSeen(home, sessionId, agentId);
  let reason: string;
  const startedAt = Date.now();
  try {
    const tops = repoTops([...run.folders, ...reviewedReposFor(home, sessionId)], run.budget);
    if (tops.length > 0) {
      const ctx = { budget: run.budget, runDir: freshRunDir(run), home };
      const user = printUserFiles(home, sessionId, run.budget, { ...run.user, repos: tops });
      const repos: Array<{ top: string; print: RepoPrint }> = [];
      for (const top of tops) repos.push({ top, print: await printRepo(top, ctx) });
      writePrivateFile(file, JSON.stringify({ repos, user, startedAt } satisfies SnapRecord));
      return SILENT;
    }
    reason = REASONS.notARepo;
  } catch (err) {
    reason = reasonOf(err, REASONS.startFailed);
  }
  try {
    fs.rmSync(runDirOf(run), { recursive: true, force: true });
    writePrivateFile(file, JSON.stringify({ unverified: reason } satisfies SnapRecord));
    mark(home, sessionId, agentId, 'start-failed');
  } catch {
    // The stop will find no usable record and say so again.
  }
  return unverified(run, reason);
}

/** The compare at a run's end, from its snapshot record (checked, not trusted). */
async function compareAtStop(run: GateRun, file: string): Promise<GateRunResult> {
  const { home, sessionId, agentId } = run;
  if (hasMark(home, sessionId, agentId, 'tamper')) return unverified(run, REASONS.tampered);
  let text: string | null;
  try {
    text = readPrivateFile(file);
  } catch {
    return unverified(run, REASONS.tampered);
  }
  if (text === null) return unverified(run, REASONS.noSnapshot);
  const record = parseRecord(text);
  if (record === null) return unverified(run, REASONS.tampered);
  if (record === 'old') return unverified(run, REASONS.versionChanged);
  if ('unverified' in record) {
    const failed = hasMark(home, sessionId, agentId, 'start-failed') && isKnownReason(record.unverified);
    return unverified(run, failed ? record.unverified : REASONS.tampered);
  }

  let changed: string[];
  try {
    const runDir = runDirOf(run);
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const ctx = { budget: run.budget, runDir, home };
    const several = record.repos.length > 1;
    changed = [];
    for (const { top, print } of record.repos) {
      for (const name of await changesSince(top, print, ctx)) changed.push(several ? `[${top}] ${name}` : name);
    }
    const repos = record.repos.map(({ top }) => top);
    changed.push(...userChanges(record.user, printUserFiles(home, sessionId, run.budget, { ...run.user, repos })));
  } catch (err) {
    return unverified(run, reasonOf(err, REASONS.checkFailed));
  }
  if (changed.length === 0) return SILENT;
  try {
    storeNotice(home, sessionId, agentId, { kind: 'void', files: changed.slice(0, MAX_STORED_PATHS), total: changed.length });
  } catch {
    // The user is still told.
  }
  return say({ systemMessage: voidMessage(changed) });
}

async function onStop(run: GateRun): Promise<GateRunResult> {
  const { home, sessionId, agentId } = run;
  let file: string;
  try {
    file = snapFile(run);
  } catch {
    return unverified(run, REASONS.recordsUnusable);
  }
  if (hasMark(home, sessionId, agentId, 'done')) return unverified(run, REASONS.tampered);
  try {
    return await compareAtStop(run, file);
  } finally {
    // After the compare: the snapshot, the run's folder and its start-failed mark go; `done` stays.
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(runDirOf(run), { recursive: true, force: true });
      clearMark(home, sessionId, agentId, 'start-failed');
      mark(home, sessionId, agentId, 'done');
    } catch {
      // Best effort.
    }
  }
}

async function subagentEvent(req: GateRunRequest, hook: Record<string, unknown>, budget: Budget): Promise<GateRunResult> {
  const agentType = hook.agent_type;
  if (typeof agentType !== 'string' || agentType === '') return SILENT;
  const folders = candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
  if (!isGateAgent(agentType, gateAgentsFor(req.env.CLAUDE_PLUGIN_ROOT, folders))) return SILENT;

  const { session_id: sessionId, agent_id: agentId } = hook;
  if (!isSafeId(sessionId) || !isSafeId(agentId) || !path.isAbsolute(req.env.HOME)) {
    logGateError(folders);
    return say({ systemMessage: unverifiedMessage(REASONS.badId) });
  }
  const user: UserContext = {
    configDir: req.env.CLAUDE_CONFIG_DIR || undefined,
    pluginRoots: [req.env.CLAUDE_PLUGIN_ROOT, req.bundleRoot].filter((root): root is string => typeof root === 'string' && root !== ''),
    pathEnv: req.env.PATH,
  };
  const run: GateRun = { home: req.env.HOME, sessionId, agentId, folders, budget, user };
  return req.event === 'subagent-start' ? onStart(run) : onStop(run);
}

/** The messages for taken notices: each notice, then once each for unreadable and unknown (planted) ones. */
function messagesOf(taken: TakenNotices): string[] {
  const messages = taken.notices.map(noticeMessage);
  if (taken.unreadable > 0) messages.push(unverifiedMessage(REASONS.noticeUnreadable));
  if (taken.unknown > 0) messages.push(unverifiedMessage(REASONS.unknownNotice));
  return messages;
}

/** Tells the main agent the messages given (nothing when there are none). */
function deliver(messages: string[]): GateRunResult {
  if (messages.length === 0) return SILENT;
  return say({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: messages.join('\n\n') } });
}

/** The foreground `Agent` result: its run's notices, or unverified when its records are unusable (a gate agent's) or its stop never finished. */
function onAgentPost(req: GateRunRequest, hook: Record<string, unknown>): GateRunResult {
  const home = req.env.HOME;
  const response = (hook.tool_response ?? {}) as { agentId?: unknown; status?: unknown };
  const sessionId = hook.session_id;
  if (sessionState(home, sessionId) === 'unusable') {
    const agentType = (hook.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type;
    const folders = candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    const gate = typeof agentType === 'string' && isGateAgent(agentType, gateAgentsFor(req.env.CLAUDE_PLUGIN_ROOT, folders));
    return gate ? deliver([unverifiedMessage(REASONS.recordsUnusable)]) : SILENT;
  }
  const messages = messagesOf(takeNotices(home, sessionId, response.agentId));
  const unfinished =
    response.status !== 'async_launched' &&
    hasMark(home, sessionId, response.agentId, 'started') &&
    !hasMark(home, sessionId, response.agentId, 'done');
  if (unfinished) messages.push(unverifiedMessage(REASONS.stopUnfinished));
  return deliver(messages);
}

/** The session's pending notices for the main agent, or unverified when the session's records cannot be used. */
function onMainPost(home: string, hook: Record<string, unknown>): GateRunResult {
  if (hook.agent_id !== undefined) return SILENT;
  const sessionId = hook.session_id;
  if (isSafeId(sessionId) && sessionState(home, sessionId) === 'unusable') return deliver([unverifiedMessage(REASONS.recordsUnusable)]);
  sweepRunFolder(home, Date.now());
  return deliver(messagesOf(takeNotices(home, sessionId)));
}

function refused(why: string): GateRunResult {
  return { exitCode: 1, stdout: '', stderr: `OSS add-repo: ${why}\n` };
}

/**
 * Names one more repo for this session's review runs: the path on the input (oss-value.sh review-repo,
 * from its value folder), else in <session>/repo-request.txt (written by the main agent with the Write
 * tool; taken, so it is used once). It must be absolute, hold no `'`, be a plain folder (not a symlink)
 * and be its repo's top.
 */
function onAddRepo(req: GateRunRequest, budget: Budget): GateRunResult {
  const sessionId = req.env.CLAUDE_CODE_SESSION_ID;
  if (!isSafeId(sessionId) || !path.isAbsolute(req.env.HOME)) return refused('no usable session id (CLAUDE_CODE_SESSION_ID)');
  const request = path.join(sessionFolder(req.env.HOME, sessionId), 'repo-request.txt');
  const text = req.input !== '' ? req.input : takePrivateFile(request);
  if (text === null) return refused(`write the repo's path to ${request} first`);
  const repo = text.replace(/\r?\n$/, '');
  if (!path.isAbsolute(repo) || repo.includes("'") || /[\r\n]/.test(repo)) return refused("the path must be one absolute path, with no ' in it");
  if (fs.lstatSync(repo, { throwIfNoEntry: false })?.isDirectory() !== true) return refused('the path is not a folder (or is a symlink)');
  const top = gitOrNull(repo, ['rev-parse', '--show-toplevel'], budget)?.trim();
  if (top === undefined || top !== fs.realpathSync(repo)) return refused("the path is not a git repo's top folder");
  addReviewedRepo(req.env.HOME, sessionId, top);
  return { exitCode: 0, stdout: `OSS will check ${top} too in this session's review runs.\n`, stderr: '' };
}

export async function runGateRun(req: GateRunRequest): Promise<GateRunResult> {
  const budget: Budget = { deadline: req.deadline ?? Date.now() + BUDGET_MS };
  if (req.event === 'add-repo') {
    try {
      return onAddRepo(req, budget);
    } catch {
      return refused('the request could not be read or recorded');
    }
  }
  let hook: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(req.input);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('hook input is not an object');
    hook = parsed as Record<string, unknown>;
  } catch {
    return say({ systemMessage: CHECK_FAILED });
  }
  try {
    switch (req.event) {
      case 'agent-post':
        return onAgentPost(req, hook);
      case 'main-post':
        return onMainPost(req.env.HOME, hook);
      default:
        return await subagentEvent(req, hook, budget);
    }
  } catch {
    logGateError(candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
    return say({ systemMessage: CHECK_FAILED });
  }
}
