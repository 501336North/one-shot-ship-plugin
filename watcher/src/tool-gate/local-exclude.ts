/**
 * Keeps the gate's own state, and the OSS workflow state, out of `git stash -u` and `git status` in a
 * repo that doesn't ignore them (Task 3b, user pick "Gate excludes its own folder locally"): their
 * paths go in the repo's local `info/exclude`, in the git common dir every worktree shares. Never
 * committed, appended only, never twice, nothing git already ignores, and never through a symlinked
 * `info/` or `info/exclude`. The caller treats any throw as "skipped".
 */

import fs from 'node:fs';
import path from 'node:path';
import { appendPrivateFile } from '../gate-run/run-store.js';
import { ignoredPaths } from './git-reader.js';
import { findRepo } from './repo-finder.js';
import { readRegularFile } from './regular-file.js';
import { timeLeft } from './deadline.js';

/**
 * The OSS state paths excluded, as gitignore lines relative to the repo top: where the state store
 * and the OSS hooks write (OSS's own layout, as state-store.ts and workflow-state.ts join it; not
 * the rule file's protected-path values).
 */
const OSS_STATE = [path.posix.join('.oss', 'tool-gates') + '/', path.posix.join('.oss', 'workflow-state.json')];
/** Largest exclude file read (a read limit; real ones are a few lines). */
const MAX_EXCLUDE_BYTES = 1024 * 1024;
/** Most time the `git check-ignore` may take (a time limit: the step must not slow the gate). */
const CHECK_IGNORE_MS = 300;
/** Repo tops where git already ignores every OSS state line: asked once per process (ship round 1, S5). */
const alreadyIgnored = new Set<string>();

/** Appends the OSS state lines the repo of `projectRoot` neither lists in `info/exclude` nor already ignores. */
export function excludeOssState(projectRoot: string): void {
  const repo = findRepo(projectRoot);
  if (repo.kind !== 'repo') return;
  const info = path.join(repo.commonDir, 'info');
  // the info folder is a real folder, right inside the repo's git dir: nothing is written elsewhere
  if (!fs.lstatSync(info).isDirectory() || fs.realpathSync(info) !== path.join(fs.realpathSync(repo.commonDir), 'info')) return;
  const file = path.join(info, 'exclude');
  const read = readRegularFile(file, MAX_EXCLUDE_BYTES, true);
  if (read === 'not-regular') return;
  const text = read === 'missing' ? '' : read.text;
  const listed = new Set(text.split('\n'));
  const missing = OSS_STATE.filter((line) => !listed.has(line));
  // git is asked only while a line is missing, so a repo already set up costs one small read
  if (missing.length === 0 || alreadyIgnored.has(repo.top)) return;
  const ignored = ignoredPaths(repo.top, missing, timeLeft(CHECK_IGNORE_MS));
  if (ignored === null) return;
  const added = missing.filter((line) => !ignored.includes(line));
  if (added.length === 0) {
    alreadyIgnored.add(repo.top);
    return;
  }
  appendPrivateFile(file, (text === '' || text.endsWith('\n') ? '' : '\n') + added.map((line) => `${line}\n`).join(''));
}
