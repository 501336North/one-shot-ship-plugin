/**
 * Unreadable rule (ADR-010, user decision; supersedes ADR-009's "unreadable = allow"): a Bash call
 * with a piece the gate can't read (a `-c` / `eval` script that is not literal, a `${…}` or
 * `$((…))` that runs a command, a syntax error) is refused when it is risky, because the piece
 * could hide what the rules would refuse. Risky means the call also:
 * - runs git that pushes, commits, changes config or writes refs;
 * - names a protected path (or a folder holding one), judged on the word's text alone;
 * - runs an interpreter or shell, which could run anything.
 * Otherwise it is allowed (and logged `unreadable`). A call over a reading limit is refused as too
 * complex to check, whatever it holds.
 */

import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { PathResolver } from '../path-resolver.js';
import { escapeGlob, globPathOf, shellGlobMayMatch } from '../patterns.js';
import { scriptFactsOf } from '../sed-awk.js';
import type { GateSettings } from '../rule-file.js';
import { protectedPathNamed } from './protected-path-mention.js';
import type { Places } from './protected-path.js';
import type { Refusal } from './refusal.js';

/**
 * git subcommands that push, commit, change config or write refs (git syntax, not rule values):
 * next to an unreadable piece, the gate can't tell which branch or remote they really touch.
 */
const GIT_WRITES = new Set([
  'push', 'commit', 'config', 'send-pack', 'update-ref', 'symbolic-ref', 'branch', 'tag', 'reset', 'checkout',
  'switch', 'merge', 'rebase', 'cherry-pick', 'revert', 'pull', 'fetch', 'am', 'stash', 'notes', 'replace',
  'filter-branch', 'fast-import', 'worktree', 'remote', 'clone', 'init',
]);

/**
 * git subcommands the gate checks for paths (git syntax): with an unknown global option before
 * them, the gate can't be sure which word git takes as the subcommand.
 */
const GIT_PATH_WRITES = new Set(['clean', 'subtree', 'http-push', 'rm', 'mv', 'restore', 'apply', 'am']);

/**
 * Refuses a git part whose global options include one the reader doesn't know, when the subcommand
 * or the word after it is one that pushes, commits, changes config or writes refs or files: the
 * unknown option may take a value, and then git runs a different subcommand than the one read.
 */
export function checkUnknownGitOption(part: CommandPart): Refusal | null {
  const git = part.git;
  if (git?.unknownOption === undefined) return null;
  const risky = [git.subcommand, git.args[0]].find((w) => w !== undefined && (GIT_WRITES.has(w) || GIT_PATH_WRITES.has(w)));
  if (risky === undefined) return null;
  return {
    rule: 'unreadable',
    reason: `Refused: \`git ${git.unknownOption}\` is a git option the gate doesn't know, so it can't tell what \`git … ${risky}\` runs. Run it without that option.`,
  };
}

/** Programs that run code they are given (shells, interpreters, `eval`, `source`); `python*` too. */
const INTERPRETERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'node', 'perl', 'ruby', 'deno', 'bun', 'osascript', 'php', 'eval', 'source', '.',
  // fix round 4, K6: expect runs Tcl, which runs commands (`exec`, `system`)
  'expect',
]);
const PYTHON = /^python[0-9.]*$/;

/** Judges a word on its text only: no symlink is followed. */
const TEXT_ONLY: PathResolver = { realpath: (p) => path.normalize(p) };

/** The reading limit's refusal: the call is too complex to check at all. */
export function tooComplex(reason: string): Refusal {
  return {
    rule: 'unreadable',
    reason: `Refused: this command is too complex for the gate to check (${reason}); split it into simpler commands.`,
  };
}

/** What makes the call risky next to an unreadable piece, for the reason; null when nothing does. */
function riskIn(part: CommandPart, settings: GateSettings, places: Places[], home: string): string | null {
  const { name } = part;
  if (name === 'git' && part.git !== null && GIT_WRITES.has(part.git.subcommand)) return `runs \`git ${part.git.subcommand}\``;
  if (name !== null && (INTERPRETERS.has(name) || PYTHON.test(name))) return `runs \`${name}\``;
  // a sed or awk script that runs (or writes) what the gate can't read is an interpreter too
  if (scriptFactsOf(name, part.words.slice(1))?.unreadable != null) return `runs a \`${name}\` script the gate can't read`;
  const dir = part.git?.dir ?? part.cwd;
  for (const word of part.words) {
    if (protectedPathNamed(word, dir, settings, places, TEXT_ONLY, home) !== null) return 'names a protected path';
    // a wildcard is judged by what it could expand to (`.os?/tool-gates.json`), on its text too
    const glob = part.globs.get(word);
    if (glob === undefined) continue;
    const pattern = globPathOf(glob, escapeGlob(dir), home);
    if (places.some((at) => shellGlobMayMatch(pattern, settings.protectedPaths, at, true, part.dotGlob))) return 'names a protected path';
  }
  return null;
}

export function checkUnreadable(
  reason: string,
  parts: CommandPart[],
  settings: GateSettings,
  root: string,
  home: string,
  caseInsensitive: boolean,
): Refusal | null {
  const places: Places[] = [{ root, home, caseInsensitive }];
  for (const part of parts) {
    const risk = riskIn(part, settings, places, home);
    if (risk === null) continue;
    return {
      rule: 'unreadable',
      reason: `Refused: part of this command can't be read (${reason}), and the command also ${risk}. Split it into simpler commands so the gate can check each one.`,
    };
  }
  return null;
}
