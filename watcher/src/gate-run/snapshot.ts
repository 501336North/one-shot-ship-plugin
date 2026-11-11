/**
 * Snapshot at the start of a review (gate) agent's run (R-266, ADR-007, ADR-009): the repo's files as
 * they stand, tracked changes and new non-ignored files, written as a git tree through a temporary
 * index (`git add -A`, `git write-tree`), so the real index is never touched. The tree id is kept in
 * `<git-dir>/oss-gate-run/<agent_id>`. git runs from argv only, never a shell; the agent id is used as a
 * file name only when it is a plain one, and a symlinked state folder or file is refused.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callingAgentOf } from '../tool-gate/calling-agent.js';
import { isGateAgent } from '../utils/gate-agents.js';

const STATE_FOLDER = 'oss-gate-run';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** True when the agent id is a plain one, safe to use as a file name. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

/** The session's environment without `GIT_*` (which could pick another repo or index). */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('GIT_')) env[name] = value;
  return { ...env, ...extra };
}

export function git(cwd: string, args: string[], extra?: Record<string, string>): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: gitEnv(extra),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** The top folder of the repo holding `cwd`. */
export function repoTop(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

/** The repo's files written as a tree through a throwaway index. */
export function writeTree(top: string): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-gate-run-'));
  try {
    const index = { GIT_INDEX_FILE: path.join(scratch, 'index') };
    git(top, ['add', '-A'], index);
    return git(top, ['write-tree'], index);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Where the state folder is: in the repo's git dir. */
export function stateFolderPath(top: string): string {
  return path.join(git(top, ['rev-parse', '--absolute-git-dir']), STATE_FOLDER);
}

/** Writes a state file without following a symlink in its place. */
export function writeStateFile(file: string, text: string): void {
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

/** The state folder in the git dir, made if missing; refused when it is a symlink or not a folder. */
function stateFolder(top: string): string {
  const dir = stateFolderPath(top);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  if (!fs.lstatSync(dir).isDirectory()) throw new Error('gate-run state folder is not a plain folder');
  return dir;
}

/**
 * For a SubagentStart of a gate agent: records the repo's tree id under its `agent_id` and returns it.
 * Null (nothing recorded) for any other agent. Throws for an unsafe agent id or a refused state folder.
 */
export function snapshotOnStart(input: Record<string, unknown>, gateAgents: readonly string[]): string | null {
  if (!isGateAgent(callingAgentOf(input), gateAgents)) return null;
  const id = input.agent_id;
  if (!isSafeId(id)) throw new Error('agent_id is not a safe file name');
  const top = repoTop(String(input.cwd));
  const tree = writeTree(top);
  writeStateFile(path.join(stateFolder(top), id), `${tree}\n`);
  return tree;
}
