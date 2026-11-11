/**
 * Compare at the end of a review (gate) agent's run (R-266, ADR-007, ADR-009): the repo's files now
 * against the tree recorded at its start (snapshot.ts). Any non-ignored change voids the review. The
 * snapshot is removed at stop; a void is kept once (`<agent_id>.void`) for the main agent's foreground
 * `Agent` PostToolUse, which arrives after SubagentStop. git runs from argv only; state files are never
 * followed through a symlink, and only plain agent ids are used as file names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { git, isSafeId, repoTop, stateFolderPath, writeStateFile, writeTree } from './snapshot.js';

export type CompareResult = { kind: 'none' } | { kind: 'void'; files: string[] } | { kind: 'error'; error: string };

const MAX_LISTED = 20;

/** A state file's text, removed once read; null when there is none. Refuses a symlinked folder or file. */
function takeStateFile(top: string, name: string): string | null {
  const dir = stateFolderPath(top);
  let folder: fs.Stats;
  try {
    folder = fs.lstatSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!folder.isDirectory()) throw new Error('gate-run state folder is not a plain folder');
  const file = path.join(dir, name);
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(file);
  }
}

/** The paths that differ between two trees (modified, added, deleted), as git lists them. */
function changedPaths(top: string, before: string, after: string): string[] {
  const out = git(top, ['diff-tree', '-r', '-z', '--no-renames', '--name-only', before, after]);
  return out.split('\0').filter((name) => name !== '');
}

/** For a SubagentStop: compares the repo with the run's snapshot, if it has one. Errors are returned, not thrown. */
export function compareOnStop(input: Record<string, unknown>): CompareResult {
  try {
    const id = input.agent_id;
    if (!isSafeId(id)) return { kind: 'none' };
    const top = repoTop(String(input.cwd));
    const before = takeStateFile(top, id);
    if (before === null) return { kind: 'none' };
    const files = changedPaths(top, before.trim(), writeTree(top));
    if (files.length === 0) return { kind: 'none' };
    writeStateFile(path.join(stateFolderPath(top), `${id}.void`), JSON.stringify(files));
    return { kind: 'void', files };
  } catch (err) {
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/** For the `Agent` PostToolUse: the changed paths kept for `tool_response.agentId`, once; null when none. */
export function takePendingVoid(input: Record<string, unknown>): string[] | null {
  const id = (input.tool_response as { agentId?: unknown } | undefined)?.agentId;
  if (!isSafeId(id)) return null;
  const top = repoTop(String(input.cwd));
  const text = takeStateFile(top, `${id}.void`);
  return text === null ? null : (JSON.parse(text) as string[]);
}

/** A path made safe for one line of the message: control characters become `?`. */
function oneLine(file: string): string {
  return file.replace(/[\u0000-\u001f\u007f]/g, '?');
}

/** What the main agent (or, for a background run, the user) is told when a review run is void. */
export function voidMessage(files: readonly string[]): string {
  const listed = files.slice(0, MAX_LISTED).map((file) => `- ${oneLine(file)}`);
  if (files.length > MAX_LISTED) listed.push(`- and ${files.length - MAX_LISTED} more`);
  return [
    "This review's report is void: the repo changed while the review ran, so it did not judge the code as it is now.",
    'Changed files:',
    ...listed,
    'Stop the ship and ask the user how to go on before acting on this review.',
  ].join('\n');
}
