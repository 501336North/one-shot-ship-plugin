/**
 * Protected-branch rule (US-001): refuses `git commit` / `git push` while the part's
 * directory is on a protected branch, and a push whose destination is a protected branch
 * (explicit refspec, `--all`, `--branches` or `--mirror`) from any branch. Branch names come only from
 * the settings.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { GateSettings } from '../rule-file.js';
import type { GitReader } from '../git-reader.js';
import { matchCommand } from '../patterns.js';
import type { Refusal } from './refusal.js';
import { readPushWords } from './push-words.js';
import { UNKNOWN } from '../tokenize.js';
import { OverBudget } from '../budget.js';
import { isTooLong } from './protected-path.js';
import { longOption } from '../sed-awk.js';

/** Ways git spells a branch ref in a refspec (git syntax, not a rule value): `refs/heads/main`, `heads/main`. */
const BRANCH_REF_PREFIXES = ['refs/heads/', 'heads/'];

/** The remote ref a refspec writes to (or deletes), as written. */
export function rawDestination(refspec: string): string {
  const spec = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const colon = spec.indexOf(':');
  return colon === -1 ? spec : spec.slice(colon + 1);
}

/** The remote branch a refspec writes to (or deletes). */
function destination(refspec: string): string {
  const dst = rawDestination(refspec);
  const prefix = BRANCH_REF_PREFIXES.find((p) => dst.startsWith(p));
  return prefix === undefined ? dst : dst.slice(prefix.length);
}

/** git's refspec wildcard (git syntax): a `*` in a pattern refspec stands for any text, `/` included. */
const REFSPEC_WILDCARD = '*';

/**
 * The protected branch names, and whether letter case is ignored when matching them (fix round 4,
 * K8): on a case-insensitive file system (macOS) `refs/heads/MAIN` is the file `refs/heads/main`.
 */
interface Branches {
  list: readonly string[];
  caseInsensitive: boolean;
}

function branchesOf(settings: GateSettings, caseInsensitive: boolean): Branches {
  return { list: settings.protectedBranches, caseInsensitive };
}

/** A name as compared: lowercased when letter case is ignored. */
function folded(name: string, branches: Branches): string {
  return branches.caseInsensitive ? name.toLowerCase() : name;
}

/** True when `name` is a protected branch. */
function isProtected(name: string, branches: Branches): boolean {
  const wanted = folded(name, branches);
  return branches.list.some((b) => folded(b, branches) === wanted);
}

/** Whether a wildcard destination (`refs/heads/*`, `*`, `refs/heads/m*`) can name the branch. */
function wildcardNames(dst: string, branch: string, branches: Branches): boolean {
  return [...BRANCH_REF_PREFIXES.map((p) => p + branch), branch].some((ref) => matchCommand(folded(dst, branches), [folded(ref, branches)]));
}

/** The protected branch a refspec can write to, or undefined. */
function protectedTarget(refspec: string, branches: Branches): string | undefined {
  const raw = rawDestination(refspec);
  if (raw.includes(REFSPEC_WILDCARD)) return branches.list.some((b) => wildcardNames(raw, b, branches)) ? raw : undefined;
  const dst = destination(refspec);
  return isProtected(dst, branches) ? dst : undefined;
}

/** `branch`: the branch an earlier part of the same command created and moved to, checked instead of the folder's. */
export async function checkProtectedBranch(
  part: CommandPart,
  settings: GateSettings,
  git: GitReader,
  branch: string | null = null,
  caseInsensitive = false,
): Promise<Refusal | null> {
  const facts = part.git;
  if (!facts || (facts.subcommand !== 'commit' && facts.subcommand !== 'push')) return null;
  const command = `git ${facts.subcommand}`;
  const protectedList = settings.protectedBranches;
  const branches = branchesOf(settings, caseInsensitive);

  const current = branch ?? (await git.currentBranch(facts.dir));
  if (current !== null && isProtected(current, branches)) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command}\` while on \`${current}\`, a protected branch. Use a feature branch.`,
    };
  }
  if (facts.subcommand !== 'push') return null;

  const { options, positional } = readPushWords(facts.args);
  const everything = options.find((word) => word === '--all' || word === '--branches' || word === '--mirror');
  if (everything !== undefined) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command} ${everything}\` can push protected branches (${protectedList.map((b) => `\`${b}\``).join(', ')}). Push one feature branch instead.`,
    };
  }
  const target = positional.slice(1).map((spec) => protectedTarget(spec, branches)).find((dst) => dst !== undefined);
  if (target === undefined) return null;
  if (target.includes(REFSPEC_WILDCARD)) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command}\` to \`${target}\`, a wildcard that can name a protected branch (${protectedList.map((b) => `\`${b}\``).join(', ')}). Push one feature branch instead.`,
    };
  }
  return {
    rule: 'protected-branch',
    reason: `Refused: \`${command}\` to \`${target}\`, a protected branch. Push a feature branch and open a PR.`,
  };
}

/** True when a branch name or ref (`x`, `refs/heads/x`, `heads/x`) can name a protected branch: one of them, or one only known when it runs. */
function namesProtected(word: string, branches: Branches): boolean {
  if (word.includes(UNKNOWN)) return true;
  const prefix = BRANCH_REF_PREFIXES.find((p) => word.startsWith(p));
  return isProtected(prefix === undefined ? word : word.slice(prefix.length), branches);
}

/** Where `git checkout -` / `@{-1}` lead (git syntax): an earlier branch, only known in the repo. */
const PREVIOUS_BRANCH = /^(?:-|@\{-[0-9]+\})$/;
/** checkout / switch options that create (or reset) the branch named by their value (git syntax). */
const NEW_BRANCH_OPTIONS = new Set(['-b', '-B', '-c', '-C', '--create', '--force-create', '--orphan']);
const TRACK_OPTIONS = /^(?:-t|--track(?:=.*)?)$/;
/** The prefix of a remote-tracking ref (`origin/main`, `refs/remotes/origin/main`): `--track` names the branch after it. */
const REMOTE_PREFIX = /^(?:refs\/remotes\/|remotes\/)?[^/]+\//;

/**
 * The branch a `git checkout` / `git switch` may leave HEAD on, when it can be a protected one, or
 * null. A checkout with paths after `--`, or of more than one word, puts files back and stays put.
 */
function switchedTo(git: NonNullable<CommandPart['git']>, branches: Branches): string | null {
  const args = git.args;
  const words: string[] = [];
  let track = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      if (i + 1 < args.length) return null;
      break;
    }
    if (NEW_BRANCH_OPTIONS.has(a)) {
      const name = args[++i];
      if (name !== undefined && namesProtected(name, branches)) return name;
    } else if (TRACK_OPTIONS.test(a)) {
      track = true;
    } else if (!a.startsWith('-') || PREVIOUS_BRANCH.test(a)) {
      words.push(a);
    }
  }
  if (git.subcommand === 'checkout' && words.length > 1) return null;
  const target = words[0];
  if (target === undefined) return null;
  if (PREVIOUS_BRANCH.test(target) || target.startsWith('@{-') || namesProtected(target, branches)) return target;
  return track && namesProtected(target.replace(REMOTE_PREFIX, ''), branches) ? target : null;
}

/**
 * Refuses a commit, push or history move (see historyMove) that runs after an earlier part of the
 * same call may have moved HEAD onto a protected branch (`git checkout main && git commit`), in any
 * folder: the gate reads the branch before the call runs, so it would check the branch the call
 * started on.
 */
export function checkBranchSwitch(
  part: CommandPart,
  parts: readonly CommandPart[],
  index: number,
  settings: GateSettings,
  exists: Exists = existsOnDisk,
  caseInsensitive = false,
): Refusal | null {
  const sub = part.git?.subcommand;
  if (sub !== 'commit' && sub !== 'push' && (part.git === null || historyMove(part.git, exists) === null)) return null;
  const branches = branchesOf(settings, caseInsensitive);
  for (let i = 0; i < index; i++) {
    const git = parts[i].git;
    if (git === null) continue;
    let target: string | null = null;
    if (git.subcommand === 'checkout' || git.subcommand === 'switch') target = switchedTo(git, branches);
    else if (git.subcommand === 'symbolic-ref') target = symbolicTarget(git.args, branches);
    if (target === null) continue;
    // a pull of the branch's own upstream after a checkout of it (`git checkout main && git pull origin main`): item 7
    if (sub === 'pull' && part.git !== null && ownUpstream(part.git, target, branches, exists)) continue;
    return {
      rule: 'protected-branch',
      reason: `Refused: \`git ${sub}\` runs after \`git ${git.subcommand} ${target}\` in the same call, which can put it on a protected branch. Run it in a separate call.`,
    };
  }
  return null;
}

/** `git symbolic-ref` options that take a value (git syntax). */
const SYMBOLIC_REF_VALUES = new Set(['-m']);

/** The words of a git subcommand that are not options or option values. */
function positionalsOf(args: readonly string[], values: ReadonlySet<string>): string[] {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return [...words, ...args.slice(i + 1)];
    if (values.has(a)) i++;
    else if (!a.startsWith('-')) words.push(a);
  }
  return words;
}

/** The protected branch `git symbolic-ref <name> <ref>` points a ref at (or `-d` deletes), or null. */
function symbolicTarget(args: readonly string[], branches: Branches): string | null {
  const [name, target] = positionalsOf(args, SYMBOLIC_REF_VALUES);
  if (target !== undefined) return namesProtected(target, branches) ? target : null;
  const deletes = args.some((a) => a === '-d' || a === '--delete');
  return deletes && name !== undefined && namesProtected(name, branches) ? name : null;
}

/** `git update-ref` options that take a value (git syntax). */
const UPDATE_REF_VALUES = new Set(['-m']);
/** `git branch` modes that move, copy, delete or force a branch (git syntax): short letters and long options. */
const BRANCH_MODE_LETTERS = /^-[A-Za-z]*[dDmMcCf]/;
const BRANCH_MODE_LONG = new Set(['--delete', '--move', '--copy', '--force']);
/** `git branch` options whose value is the next word (git syntax); `--opt=value` carries it attached. */
const BRANCH_VALUES = new Set(['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '-u', '--set-upstream-to']);

function refChange(command: string, branch: string): Refusal {
  return {
    rule: 'protected-branch',
    reason: `Refused: \`${command}\` changes \`${branch}\`, a protected branch. Ask the user to run it with \`!\`.`,
  };
}

/**
 * Refuses a git call that moves, renames, copies onto, deletes or points a ref at a protected
 * branch without a commit or push: `git update-ref refs/heads/main …`, `git branch -f|-m|-M|-c|-C|-d|-D`
 * naming one, `git symbolic-ref HEAD refs/heads/main`, and (from any branch, fix part K11) `git rebase
 * <upstream> <protected>` and `git worktree add -b|-B <protected>`. `git update-ref HEAD …` moves the current
 * branch, so it is checked like a commit. `git update-ref --stdin` takes its refs from stdin, which
 * the gate can't read.
 */
export async function checkBranchRefs(
  part: CommandPart,
  settings: GateSettings,
  git: GitReader,
  caseInsensitive = false,
): Promise<Refusal | null> {
  const facts = part.git;
  if (facts === null) return null;
  const branches = branchesOf(settings, caseInsensitive);
  const { subcommand, args } = facts;
  if (subcommand === 'update-ref') {
    if (args.includes('--stdin')) {
      return { rule: 'protected-branch', reason: 'Refused: `git update-ref --stdin` reads the refs it changes from stdin, which the gate can\'t check. Change one ref per call instead.' };
    }
    const [ref] = positionalsOf(args, UPDATE_REF_VALUES);
    if (ref === undefined) return null;
    if (ref === 'HEAD') {
      if (args.includes('--no-deref')) return null;
      const current = await git.currentBranch(facts.dir);
      return current !== null && isProtected(current, branches) ? refChange('git update-ref HEAD', current) : null;
    }
    return namesProtected(ref, branches) ? refChange(`git update-ref ${ref}`, ref) : null;
  }
  if (subcommand === 'symbolic-ref') {
    const target = symbolicTarget(args, branches);
    return target === null ? null : refChange(`git symbolic-ref … ${target}`, target);
  }
  if (subcommand === 'checkout' || subcommand === 'switch') {
    const reset = forceCreated(args).find((name) => namesProtected(name, branches));
    return reset === undefined ? null : refChange(`git ${subcommand} ${args.join(' ')}`, reset);
  }
  if (subcommand === 'rebase') {
    const rebased = rebasedBranch(args, branches);
    return rebased === undefined ? null : refChange(`git rebase ${args.join(' ')}`, rebased);
  }
  if (subcommand === 'worktree') {
    const created = worktreeBranch(args, branches);
    return created === undefined ? null : refChange(`git worktree ${args.join(' ')}`, created);
  }
  if (subcommand === 'fetch') {
    const target = positionalsOf(args, FETCH_VALUES).slice(1).filter((spec) => spec.includes(':')).map((spec) => protectedTarget(spec, branches)).find((dst) => dst !== undefined);
    return target === undefined ? null : refChange(`git fetch ${args.join(' ')}`, target);
  }
  if (subcommand !== 'branch') return null;
  const mode = args.find((a) => (!a.startsWith('--') && BRANCH_MODE_LETTERS.test(a)) || BRANCH_MODE_LONG.has(a));
  if (mode === undefined) return null;
  const named = positionalsOf(args, BRANCH_VALUES).find((w) => namesProtected(w, branches));
  return named === undefined ? null : refChange(`git branch ${mode} … ${named}`, named);
}

/**
 * How a git subcommand reads its options (git's parse-options, fix part K11): the short letters that
 * take a value (the rest of their cluster, or the next word: `-qB main`, `-Bmain`), the letters whose
 * value is only the rest of their cluster (`-Skey`), and the long options that take one, each with
 * the shortest prefix git accepts as unambiguous (`--force-c main`, `--force-cr=main`).
 */
interface OptionSpec {
  valueLetters: ReadonlySet<string>;
  restLetters?: ReadonlySet<string>;
  valueLongs: ReadonlyArray<{ full: string; shortest: number }>;
}

/** The option values (by the option's short or full long name) and the operands of a git subcommand's words, read as git reads them. */
function readOptions(args: readonly string[], spec: OptionSpec): { values: Array<[string, string]>; operands: string[] } {
  const values: Array<[string, string]> = [];
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const long = spec.valueLongs.find((o) => longOption(a, o.full, o.shortest));
      const value = long === undefined ? undefined : a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
      if (long !== undefined && value !== undefined) values.push([long.full, value]);
    } else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (spec.restLetters?.has(a[j]) === true) break;
        if (!spec.valueLetters.has(a[j])) continue;
        const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (value !== undefined) values.push([`-${a[j]}`, value]);
        break;
      }
    } else {
      operands.push(a);
    }
  }
  return { values, operands };
}

/**
 * checkout / switch options (git syntax): `-b`/`-c`/`--create` and `-B`/`-C`/`--force-create` name the
 * branch they create; `-U`, `--orphan`, `--conflict`, `--pathspec-from-file` take a value too. `-t`
 * is read as a plain flag, so `-tB main` (an error in git) is still read as `-B main`.
 */
const SWITCH_OPTIONS: OptionSpec = {
  valueLetters: new Set(['b', 'B', 'c', 'C', 'U']),
  valueLongs: [
    { full: '--force-create', shortest: 8 }, { full: '--create', shortest: 4 }, { full: '--orphan', shortest: 4 },
    { full: '--conflict', shortest: 5 }, { full: '--pathspec-from-file', shortest: 4 },
  ],
};
/** checkout / switch options that reset the branch they name to another commit, creating it if needed (git syntax). */
const FORCE_CREATE = new Set(['-B', '-C', '--force-create']);

/** The branches a `git checkout -B` / `git switch -C|--force-create` resets, in any spelling (fix round 4, K8; fix part K11). */
function forceCreated(args: readonly string[]): string[] {
  return readOptions(args, SWITCH_OPTIONS).values.filter(([option]) => FORCE_CREATE.has(option)).map(([, name]) => name);
}

/**
 * `git rebase` options that take a value (git syntax): `-C`, `-x`/`--exec`, `-s`/`--strategy`, `-X`/
 * `--strategy-option`, `--onto`, `--trailer`, `--whitespace`, `--empty`; `-S`/`-r` take only the rest
 * of their cluster. `--strategy` and `--strategy-option` both take one, so any prefix of 5+ counts.
 */
const REBASE_OPTIONS: OptionSpec = {
  valueLetters: new Set(['C', 'x', 's', 'X']),
  restLetters: new Set(['S', 'r']),
  valueLongs: [
    { full: '--onto', shortest: 3 }, { full: '--exec', shortest: 4 }, { full: '--strategy-option', shortest: 5 },
    { full: '--trailer', shortest: 3 }, { full: '--whitespace', shortest: 3 }, { full: '--empty', shortest: 4 },
  ],
};
/** `git rebase --root` (git syntax; `--ro` is its shortest unambiguous prefix): no upstream, the one operand is the branch. */
const REBASE_ROOT = { full: '--root', shortest: 4 };

/**
 * The branch `git rebase [<upstream>] <branch>` first switches to and then rewrites, when it names a
 * protected one (fix part K11): every operand after the upstream (all of them with `--root`), from
 * any branch. `git rebase main` names only the upstream.
 */
function rebasedBranch(args: readonly string[], branches: Branches): string | undefined {
  const root = args.some((a) => a.startsWith('--') && longOption(a, REBASE_ROOT.full, REBASE_ROOT.shortest));
  return readOptions(args, REBASE_OPTIONS).operands.slice(root ? 0 : 1).find((w) => namesProtected(w, branches));
}

/** `git worktree add` options that take a value (git syntax): `-b` / `-B` name the branch it creates (or resets), `--reason` its lock note. */
const WORKTREE_ADD_OPTIONS: OptionSpec = { valueLetters: new Set(['b', 'B']), valueLongs: [{ full: '--reason', shortest: 5 }] };

/** The protected branch `git worktree add -b|-B <branch>` creates or resets (fix part K11), or undefined. */
function worktreeBranch(args: readonly string[], branches: Branches): string | undefined {
  if (args[0] !== 'add') return undefined;
  // only `-b` / `-B` name a branch; `--reason`'s value is a note (fix part K12)
  return readOptions(args.slice(1), WORKTREE_ADD_OPTIONS)
    .values.filter(([option]) => WORKTREE_ADD_OPTIONS.valueLetters.has(option.slice(1)))
    .map(([, name]) => name)
    .find((name) => namesProtected(name, branches));
}

/** `git fetch` options that take the next word as their value (git syntax), so it is not read as the repository or a refspec. */
const FETCH_VALUES = new Set([
  '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '-j', '--jobs', '--upload-pack', '-o', '--server-option',
  '--negotiation-tip', '--refmap', '--filter',
]);

/** What the gate knows about the repository git uses in a folder (see repo-finder.ts). */
export type RepoTrustOf = (dir: string) => 'trusted' | 'none' | { untrusted: string };

/**
 * `trustOf` for one call (fix round 4, K8): each folder is judged once, and a folder path over the
 * length the gate checks (isTooLong) is refused as too complex before any walk on disk, since
 * judging walks up every folder of it.
 */
export function trustForCall(trustOf: RepoTrustOf): RepoTrustOf {
  const known = new Map<string, ReturnType<RepoTrustOf>>();
  return (dir) => {
    if (isTooLong(dir)) throw new OverBudget('git runs in a folder path over 4096 characters or 512 folders');
    const trust = known.get(dir) ?? trustOf(dir);
    known.set(dir, trust);
    return trust;
  };
}

/**
 * Refuses a commit or push in a folder whose repository the gate can't vouch for (a `.git` file
 * pointing at a git folder the agent could have written): that folder's HEAD would decide which
 * branch the gate checks, and its settings where a push goes.
 */
export function checkRepoTrust(part: CommandPart, trustOf: RepoTrustOf): Refusal | null {
  const facts = part.git;
  if (facts === null || (facts.subcommand !== 'commit' && facts.subcommand !== 'push')) return null;
  const trust = trustOf(facts.dir);
  if (trust === 'trusted' || trust === 'none') return null;
  return {
    rule: 'protected-branch',
    reason: `Refused: \`git ${facts.subcommand}\` runs in a repository the gate can't vouch for (${trust.untrusted}), so it can't tell which branch it is on or where it pushes. Ask the user to run it with \`!\`.`,
  };
}

/** True when a path exists on disk (a link counts, even a broken one). */
export type Exists = (absPath: string) => boolean;

function existsOnDisk(absPath: string): boolean {
  return fs.lstatSync(absPath, { throwIfNoEntry: false }) !== undefined;
}

/**
 * git subcommands that move the current branch to other commits (git syntax): merge, rebase,
 * cherry-pick, revert and am make commits on it; their `--abort` and `--quit` stop without moving
 * it (fix round 4, K3). `--continue`, `--skip` and `--resolved` finish a move, so they count.
 */
const HISTORY_MOVERS = new Set(['merge', 'rebase', 'cherry-pick', 'revert', 'am']);
const STOPS_WITHOUT_MOVING = new Set(['--abort', '--quit', '--edit-todo', '--show-current-patch']);
/** cherry-pick / revert options that apply the change without committing it (git syntax): HEAD stays put. */
const NO_COMMIT = /^(?:-n|--no-commit|-(?=[A-Za-z]*n)[A-Za-z]+)$/;
/** `git reset` options that take a value (git syntax). */
const RESET_VALUES = new Set(['--pathspec-from-file']);
/** `git reset` options that only change the index or the files named (git syntax): HEAD stays put. */
const RESET_PATHS_ONLY = /^(?:-p|--patch|--pathspec-from-file(?:=.*)?)$/;
/** What `HEAD` is called (git syntax): resetting to it moves nothing. */
const HEAD_NAMES = new Set(['HEAD', '@']);
/** Characters a commit name can't hold but a pathspec can (git refname rules): `*`, `?`, `[`, and pathspec magic `:`. */
const PATHSPEC_ONLY = /[*?[]|^:/;

/**
 * True when `git reset <args>` moves HEAD: it names exactly one commit and no paths. With `--`, the
 * words before it are the commit and those after it paths; without, git takes a lone word as a
 * path when it exists on disk, and two or more words as a commit and paths (git rev-parse rules).
 */
function resetMoves(args: readonly string[], dir: string, exists: Exists): boolean {
  if (args.some((a) => RESET_PATHS_ONLY.test(a))) return false;
  const dash = args.indexOf('--');
  const before = positionalsOf(dash === -1 ? args : args.slice(0, dash), RESET_VALUES);
  const after = dash === -1 ? [] : args.slice(dash + 1);
  if (before.length !== 1 || after.length > 0) return false;
  const [target] = before;
  if (HEAD_NAMES.has(target)) return false;
  if (dash !== -1) return true;
  return !PATHSPEC_ONLY.test(target) && !exists(path.resolve(dir, target));
}

/** `git branch` options that rename (git syntax); with one branch named, the current branch is renamed. */
const BRANCH_RENAME = /^(?:-(?=[A-Za-z]*[mM])[A-Za-z]+|--move)$/;

/**
 * The command, as shown, when this git part moves or renames the branch HEAD is on (fix round 4,
 * K3): a merge, rebase, cherry-pick, revert or am that commits, a reset to another commit, or a
 * `git branch -m <new>` naming only the new name. `git pull` and `git fetch` are not counted (user decision).
 */
function historyMove(git: NonNullable<CommandPart['git']>, exists: Exists): string | null {
  const { subcommand: sub, args } = git;
  if (HISTORY_MOVERS.has(sub)) {
    if (args.some((a) => STOPS_WITHOUT_MOVING.has(a))) return null;
    if ((sub === 'cherry-pick' || sub === 'revert') && args.some((a) => NO_COMMIT.test(a))) return null;
    return `git ${sub}`;
  }
  if (sub === 'reset') return resetMoves(args, git.dir, exists) ? `git reset ${args.join(' ')}` : null;
  if (REWRITERS.has(sub)) return `git ${sub}`;
  if ((sub === 'reflog' && REFLOG_DROPS.has(args[0])) || (sub === 'subtree' && SUBTREE_MOVES.has(args[0]))) return `git ${sub} ${args[0]}`;
  // a pull of anything but the branch's own upstream is judged once the branch is known (ownUpstream): item 7
  if (sub === 'pull' && positionalsOf(args, PULL_VALUES).length > 0) return `git pull ${args.join(' ')}`;
  if (sub === 'branch' && args.some((a) => BRANCH_RENAME.test(a)) && positionalsOf(args, BRANCH_VALUES).length === 1) {
    return `git branch ${args.join(' ')}`;
  }
  return null;
}

/**
 * git subcommands that rewrite or drop the history of the current branch, or of the branches they
 * name (git syntax; fix round 4, K8): filter-branch, filter-repo, fast-import and replace; `reflog
 * delete|expire` drop the entries a lost commit is found by; `subtree merge|pull` merge into HEAD.
 */
const REWRITERS = new Set(['filter-branch', 'filter-repo', 'fast-import', 'replace']);
const REFLOG_DROPS = new Set(['delete', 'expire']);
const SUBTREE_MOVES = new Set(['merge', 'pull']);
/** Options that name every branch (git syntax). */
const EVERY_BRANCH = new Set(['--all', '--branches']);
/** A reflog entry's suffix (`main@{1}`, git syntax): the branch is the name before it. */
const REFLOG_ENTRY = /@\{[^}]*\}$/;

/**
 * The protected branch (or `--all`) a rewrite names, whatever branch HEAD is on, or null. git
 * filter-repo rewrites every branch unless given `--refs`.
 */
function namedRewrite(git: NonNullable<CommandPart['git']>, branches: Branches): string | null {
  const { subcommand: sub, args } = git;
  if (!REWRITERS.has(sub) && sub !== 'reflog') return null;
  if (sub === 'filter-repo' && !args.some((a) => a === '--refs' || a.startsWith('--refs='))) return 'every branch';
  const named = args.find((a) => EVERY_BRANCH.has(a) || namesProtected(a.replace(/^\+/, '').replace(REFLOG_ENTRY, '').replace(/^--refs=/, ''), branches));
  return named ?? null;
}

/** `git pull` options that take the next word as their value (git syntax), so it is not read as the repository or a branch. */
const PULL_VALUES = new Set([
  '-s', '--strategy', '-X', '--strategy-option', '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '-j', '--jobs',
  '--upload-pack', '-o', '--server-option', '--negotiation-tip',
]);
/** A remote's name (git syntax): not `.`, a path or a URL. */
const REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * True when a `git pull` on `branch` takes only that branch's own upstream (user decision
 * 2026-11-10): no repository, or a remote by name (not a folder on disk) with at most the same
 * branch name (`origin main`, `origin refs/heads/main`), no `:` or `+`.
 */
function ownUpstream(git: NonNullable<CommandPart['git']>, branch: string, branches: Branches, exists: Exists): boolean {
  const [repo, ...specs] = positionalsOf(git.args, PULL_VALUES);
  if (repo === undefined) return true;
  if (!REMOTE_NAME.test(repo) || exists(path.resolve(git.dir, repo))) return false;
  const name = (ref: string): string => folded(ref.replace(/^(?:refs\/heads\/|heads\/)/, ''), branches);
  return specs.every((spec) => !spec.includes(':') && !spec.startsWith('+') && name(spec) === name(branch));
}

/**
 * Refuses a merge, rebase, cherry-pick, revert, am, a reset that moves HEAD, or a one-name
 * `git branch -m`, while the folder is on a protected branch (or in a folder the gate can't follow,
 * where the branch is unknown): each moves or renames that branch without a commit or push the
 * other rules see. `created`: the branch an earlier part created and moved to, checked instead.
 */
export async function checkHistoryMove(
  part: CommandPart,
  settings: GateSettings,
  git: GitReader,
  created: string | null = null,
  exists: Exists = existsOnDisk,
  caseInsensitive = false,
): Promise<Refusal | null> {
  const facts = part.git;
  if (facts === null) return null;
  const command = historyMove(facts, exists);
  if (command === null) return null;
  const branches = branchesOf(settings, caseInsensitive);
  const named = namedRewrite(facts, branches);
  if (named !== null) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command}\` names \`${named}\`, which can rewrite a protected branch's history. Ask the user to run it with \`!\`.`,
    };
  }
  if (part.lostDir !== null && created === null) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command}\` runs after \`${part.lostDir.why}\`, in a folder the gate can't follow, so it can't tell whether it moves a protected branch. Run it after a \`cd\` to a plain path.`,
    };
  }
  const current = created ?? (await git.currentBranch(facts.dir));
  if (current === null || !isProtected(current, branches)) return null;
  if (facts.subcommand === 'pull' && ownUpstream(facts, current, branches, exists)) return null;
  return {
    rule: 'protected-branch',
    reason: `Refused: \`${command}\` while on \`${current}\`, a protected branch, moves its history. Use a feature branch.`,
  };
}
