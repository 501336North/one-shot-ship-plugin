/**
 * Gate-agent-write rule (R-266 US-004): a review (gate) agent may not change what it judges. Its
 * scope is the reviewed repos (the project root and the repo holding the hook's folder, a sibling
 * worktree) and the user-level folders that decide the review or how git behaves (all of `~/.oss`
 * and `~/.claude`, and the user's git config files under the home folder). Its edit-tool writes and the Bash writes the
 * command reader sees are refused when they land there, or on a folder holding one, checked as
 * written (`..` collapsed) and as they really are on disk (symlinks followed). A wildcard is judged
 * by its folder part before the first wildcard. A write whose path is only known when the command
 * runs is refused, since the gate can't tell where it lands.
 *
 * Round 3 (user decision 2026-11-12, "keep fixing: allowlist"): a review agent's call is read in
 * full and runs only what the gate knows.
 * - The whole call: refused when any piece can't be read (eval, source, a script only known when it
 *   runs …), when a part runs in a folder only known when it runs, and when a `for`/`select` loop
 *   sets a risky variable.
 * - Variables: setting HOME, PATH, CDPATH, IFS, ENV, BASH_ENV, PROMPT_COMMAND, SHELLOPTS, BASHOPTS,
 *   NODE_OPTIONS, PYTHONPATH/PYTHONSTARTUP (and a few more), LD_*, DYLD_*, GIT_* is refused, inline,
 *   standalone, or through export/declare/typeset/readonly/local, `declare -n` and `printf -v`.
 * - The review allowlist: every program is one the plugin's reviewPrograms setting names
 *   (config/tool-gates.json, plugin only, covering every stack's checks; a name entry matches a
 *   program found on PATH or run by path from inside a reviewed repo, a path entry that exact file,
 *   and `prog sub …` entries the words the call starts with; runners such as `uv run`, `bundle exec`,
 *   `npx`, `python -m` are judged by what they run), plus the programs the user adds under
 *   toolGates.reviewPrograms in their own ~/.oss/config.json (never a repo's file); an option the
 *   reviewWriteOptions setting names (fix, write, autocorrect, report-file options) takes it off the list. Or a
 *   form the gate knows: git and gh read forms, cd/pushd/popd and `set`
 *   flags, the write tools (mkdir rm cp mv touch tee ln, their targets checked as above), test runs
 *   from testCommandPatterns (no snapshot updates), builds, lint and type checks that don't rewrite
 *   files, read-only package commands, node/python/bash with inline code or with a script file that
 *   exists in the reviewed repo, curl/wget that only print, and the wrappers timeout, nice, time,
 *   env, command and xargs (xargs only with a reviewPrograms program). `find -exec` only runs a
 *   reviewPrograms program, and find's write actions and `sed -i` are refused. A program given by
 *   path must be the reviewed repo's own. `kill` is the penetration tester's, for its own jobs.
 * Round 4: no listed program may be a way to write a file or run another program. A runner (npx,
 * bunx, npm/pnpm/yarn exec, poetry/pipenv run, bundle exec, uv run with a frozen environment,
 * python -m) runs only a JS tool the gate knows, a reviewNpxPackages package, a test command or the
 * repo's own node_modules/.bin, and what it runs is read again and checked as its own part (write
 * tools, cd, git and wrappers behind a runner are refused). Options that write or run (output
 * files, in-place edits, exec hooks, lock updates, non-GET curl) are refused; build tools run only
 * the goals the gate knows; tsc only checks. The setup-step exemption covers every agent.
 * - Work that outlives the run: run in the background here (`&`, a Bash call sent with
 *   `run_in_background`, nohup, tmux, `ssh -f`, `docker run -d` …), or scheduled, handed to the
 *   system (`brew services start|run|restart`, launchctl …) or a nested `claude` session. The one
 *   exception (user decision 2026-11-12): the settings' backgroundAgents (the penetration tester)
 *   may run work in the background, with any program, when the part runs entirely outside the
 *   reviewed repos: its folder known and existing, every operand and option value outside them,
 *   and no earlier part in the call that moves where paths point (eval, source, ln, a HOME or
 *   other risky assignment). Scheduled work and nested sessions stay refused for it too.
 * - The review check's own entry points (gate-run.cjs / gate-run.js / oss-gate-run.sh), anywhere.
 * - git with a GIT_* variable set in the call, or writing the user's git config (any prefix of
 *   --global/--system/--file, `-f`, `config set --global`), anywhere; `git init`/`git clone` into a
 *   reviewed repo or the user-level folders.
 * - In a reviewed repo: git other than a read-only subcommand, git under another name (`git-*`,
 *   git's exec path, `hub`), and changes to installed dependencies.
 * - `gh` other than its read forms, anywhere; `ln` on anything in a reviewed repo or the user-level
 *   folders (a hard link is not resolved by realpath); the agent offloader under any name but the
 *   caller's own.
 * A review agent's own setup steps (model check, key check, decrypt, offload), line for line a bash
 * block of its agent file in the plugin folder the gate runs from, are the one exception to the
 * review rules above. The reviewed repos include those the main agent named for the session's
 * review runs (~/.oss/gate-state/<session>/repos.json).
 * Known limits: `make`, a repo's own scripts and inline node/python code run what they hold; the
 * reviewed repo's own scripts are trusted as the review's subject. A copy of the review check or
 * the offloader outside the repo can only be run by the penetration tester, in its sandbox.
 * A builder, the main agent or an agent the gate doesn't know is never refused here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCommand, type CommandPart } from '../command-reader.js';
import type { EditCall } from '../edit-call.js';
import type { PathResolver } from '../path-resolver.js';
import type { GateSettings } from '../rule-file.js';
import { UNKNOWN } from '../tokenize.js';
import { tick } from '../deadline.js';
import { isGateAgent } from '../../utils/gate-agents.js';
import { isSameOrAncestor } from './protected-path.js';
import type { Refusal } from './refusal.js';
import { matchCommand } from '../patterns.js';
import { linkInto } from '../review-places.js';
import {
  ALLOWED_WRAPPERS,
  changesInstalled,
  changingScriptRun,
  findExecs,
  GETOPT_PROGRAMS,
  longOptionMatch,
  riskyExpansionVariable,
  setterNameNotLiteral,
  goalsAllowed,
  interpreterForm,
  isInterpreter,
  isJsTool,
  scriptRun,
  SINGLE_DASH_LONG,
  positionals,
  valueOptionsOf,
  knownForm,
  namedProgramMisused,
  ownJobs,
  riskyAssignment,
  riskyLoopVariable,
  VARIABLE_SETTERS,
  gitByOtherName,
  optionName,
  optionValues,
  launchOf,
  PACKAGE_DIR_OPTIONS,
  packageCommand,
  readOnlyGh,
  readOnlyGit,
  scriptArgument,
  writesUserGitConfig,
} from './review-commands.js';

const WILDCARD_SEGMENT = /[*?[]/;

const REPORT_ONLY =
  'Review agents review and report only: report the problem and the fix, and the stack\'s builder agent (for example oss:typescript-pro) makes the change.';

/** git global options that change what git runs or which repo and files it uses. */
const GIT_SETUP_OPTIONS = ['-c', '--config-env', '--exec-path', '--git-dir', '--work-tree'];
/** Variables that point git at another repo or work tree. */
const GIT_DIR_VARIABLES = new Set(['GIT_DIR', 'GIT_WORK_TREE']);
/** The review check's entry points, by file name. */
const REVIEW_CHECK_FILES = new Set(['gate-run.cjs', 'gate-run.js', 'oss-gate-run.sh']);
/** User-level files and folders a review agent may not write, relative to the home folder. */
const USER_LEVEL_OFF_LIMITS = [
  '.oss', '.claude', '.gitconfig', '.config', '.ssh', '.npmrc',
  // the shell's own start-up files run in every later session
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout',
];
/** Programs earlier in a call after which the gate can't be sure where a later part runs (found by exact name). */
const MOVES_UNSEEN = new Set(['eval', 'source', '.', 'ln']);
/** A word that hands a command string to another program (`tmux new "cd x && y"`). */
const COMMAND_STRING = /[\s;&|<>()`]/;
const OFFLOADER = /(^|\/)agent-offload\.[cm]?[jt]s$/;
/** Builtins that only change the shell's folder (found by exact name). */
const FOLDER_MOVES = new Set(['cd', 'pushd', 'popd']);

/** The rest of the Bash call a part belongs to: the parts before it, and whether the call runs in the background. */
export interface BashCall {
  earlier?: readonly CommandPart[];
  background?: boolean;
  /** How many runners or find -exec the part runs inside. */
  depth?: number;
}

/** What a review agent judges: the reviewed repos, and the home folder its user-level files live in. */
export interface ReviewScope {
  repos: readonly string[];
  home: string;
  /** True when the path exists on disk now (a script file, the folder a sandbox part runs in). */
  exists: (absPath: string) => boolean;
  /** The temp folders, the only places a review agent may write (round 6, user choice 2). */
  temp: readonly string[];
  /**
   * No OS sandbox contains the call (round 8, D4: Linux, Windows, sandbox-exec unusable or turned
   * off): inline code and scripts outside the reviewed repos are refused.
   */
  fallback?: boolean;
  /** The call runs on macOS (round 9, D-R9-3: Swift, JVM/Gradle and .NET builds and tests are refused there). */
  darwin?: boolean;
  /** The call runs inside the macOS review sandbox, where gh can't read its login (round 9, CR LOW-1). */
  sandboxed?: boolean;
  /**
   * The agent's own private folder, the only place its Write/Edit tools may write (round 10,
   * D-R10-2); null when it can't be made. Bash writes are held by the sandbox or the temp rules.
   */
  privateDir?: string | null;
  /** The offload folders the agent's own `mktemp -d -t oss-offload.XXXXXX` step made (round 11, SEC LOW-2). */
  offloadFolders?: readonly string[];
}

/** The /dev files a write may always go to: they keep nothing. */
const DEV_SINK = /^\/dev\/(?:null|stdout|stderr|stdin|tty|fd\/[0-9]+)$/;
/** Longest word the gate does path work on; a longer one is refused (round 6, perf C1). */
const MAX_WORD = 4096;

/**
 * True when a write to the path lands in a temp folder (or a /dev sink), as written and as it is on
 * disk, and not on the home folder, a reviewed repo or the user-level files that sit there (round 6, user choice 2).
 */
function inTemp(target: string, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  if (target.includes(UNKNOWN) || target.length > MAX_WORD) return false;
  if (DEV_SINK.test(target)) return true;
  const fixed = fixedPart(target);
  const roots = rootsOf(scope.temp, paths);
  const forms = [path.normalize(fixed), paths.realpath(fixed)];
  // the home folder is never a temp folder, even when TMPDIR holds it
  return forms.every((p) => roots.some((r) => isSameOrAncestor(r, p, caseInsensitive))) && !touches(target, [...offLimits(scope), scope.home], paths, caseInsensitive);
}

/** Where a review agent may not write: the reviewed repos and the user-level files. */
function offLimits(scope: ReviewScope): string[] {
  return [...scope.repos, ...userLevel(scope)];
}

/** The user-level files and folders a review agent may not write, under the home folder. */
function userLevel(scope: ReviewScope): string[] {
  return USER_LEVEL_OFF_LIMITS.map((p) => path.join(scope.home, p));
}

/** The path up to its first wildcard segment. */
function fixedPart(p: string): string {
  const segments = p.split('/');
  const first = segments.findIndex((segment) => WILDCARD_SEGMENT.test(segment));
  return first === -1 ? p : segments.slice(0, first).join('/') || '/';
}

/** The places as given and as they are on disk. */
function rootsOf(places: readonly string[], paths: PathResolver): string[] {
  return places.flatMap((place) => [place, paths.realpath(place)]);
}

/** True when the path is in one of the places or is a folder holding one, as written or as it is on disk. */
function touches(absPath: string, places: readonly string[], paths: PathResolver, caseInsensitive: boolean): boolean {
  const fixed = fixedPart(absPath);
  const forms = [path.normalize(fixed), paths.realpath(fixed)];
  const roots = rootsOf(places, paths);
  return forms.some((p) => roots.some((r) => isSameOrAncestor(r, p, caseInsensitive) || isSameOrAncestor(p, r, caseInsensitive)));
}

/** True when the folder is inside a reviewed repo (or only known when the command runs). */
function insideRepo(dir: string, repos: readonly string[], paths: PathResolver, caseInsensitive: boolean): boolean {
  if (dir.includes(UNKNOWN)) return true;
  const fixed = fixedPart(dir);
  const forms = [path.normalize(fixed), paths.realpath(fixed)];
  return forms.some((p) => rootsOf(repos, paths).some((r) => isSameOrAncestor(r, p, caseInsensitive)));
}

function refusal(what: string): Refusal {
  return { rule: 'gate-agent-write', reason: `Refused by gate-agent-write: ${what}. ${REPORT_ONLY}` };
}

export function checkGateAgentEdit(
  call: Pick<EditCall, 'filePath'>,
  agent: string | undefined,
  settings: GateSettings,
  scope: ReviewScope,
  paths: PathResolver,
  caseInsensitive = false,
): Refusal | null {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  const own = scope.privateDir ?? null;
  if (own !== null && inOwnFolder(call.filePath, own, scope, paths, caseInsensitive)) return null;
  if (newOffloadPrompt(call.filePath, scope.temp) && (scope.offloadFolders ?? []).includes(path.dirname(call.filePath))) return null;
  const instead = own === null ? "its private folder can't be made right now" : `write in its own private folder \`${own}\` instead`;
  return refusal(`a review agent's Write and Edit tools may write only in its own private folder, not \`${call.filePath}\`; ${instead}`);
}

/** True when the file is in the agent's own folder, as written and on disk, and off every protected place. */
function inOwnFolder(file: string, own: string, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  if (file.includes(UNKNOWN) || file.length > MAX_WORD || !path.isAbsolute(file)) return false;
  const forms = [path.normalize(file), paths.realpath(path.normalize(file))];
  return (
    forms.every((p) => isSameOrAncestor(own, p, caseInsensitive) && p !== own) &&
    !touches(file, [...offLimits(scope), scope.home], paths, caseInsensitive) &&
    // round 11, SEC CRITICAL-1: no link in the private folder on the way
    !linkInto(file, own, caseInsensitive)
  );
}

/**
 * True when the file is a NEW `prompt.md` in a folder `mktemp -d -t oss-offload.XXXXXX` made for this
 * user directly in a temp folder (0700, ours, not a link): the served offload step's one write
 * outside the private folder (round 10, D-R10-2). Create only: an existing prompt.md is refused.
 */
function newOffloadPrompt(file: string, temp: readonly string[]): boolean {
  if (!path.isAbsolute(file) || path.normalize(file) !== file || path.basename(file) !== 'prompt.md') return false;
  const folder = path.dirname(file);
  if (!/^oss-offload\.[A-Za-z0-9.]+$/.test(path.basename(folder)) || !offloadFolderSafe(folder, temp)) return false;
  return fs.lstatSync(file, { throwIfNoEntry: false }) === undefined;
}

/** A path word as the shell gives it to the program: `~` and `~/x` under the home folder; `~user` only known when it runs. */
function absolute(word: string, cwd: string, home: string): string {
  if (word === '~' || word.startsWith('~/')) return path.join(home, word.slice(1));
  return word.startsWith('~') ? UNKNOWN : path.resolve(cwd, word);
}

/** The global option words between `git` and its subcommand. */
function gitGlobals(part: CommandPart, git: NonNullable<CommandPart['git']>): string[] {
  return part.words.slice(1, Math.max(1, part.words.length - git.args.length - 1));
}

/** True when the part runs in a reviewed repo (or where it runs is only known when it runs). */
function runsInRepo(part: CommandPart, dirs: readonly string[], scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  return part.lostDir !== null || [part.cwd, ...dirs].some((dir) => insideRepo(dir, scope.repos, paths, caseInsensitive));
}

/** The refusal for git in a reviewed repo that may change it, or null. */
function checkGit(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): Refusal | null {
  const { git } = part;
  if (git === null) return null;
  if (writesUserGitConfig(git.subcommand, git.args)) return refusal('a review agent may not change the user\'s or the system\'s git config');
  const pointed = [
    ...optionValues(gitGlobals(part, git), ['--git-dir', '--work-tree']),
    ...part.assignments.flatMap((name, i) => (GIT_DIR_VARIABLES.has(name) ? [part.assignmentValues[i] ?? UNKNOWN] : [])),
  ].map((p) => path.resolve(part.cwd, p));
  if (!runsInRepo({ ...part, cwd: git.dir }, pointed, scope, paths, caseInsensitive)) return null;
  const setup = gitGlobals(part, git).some((w) => GIT_SETUP_OPTIONS.includes(optionName(w)));
  if (!setup && git.unknownOption === undefined && readOnlyGit(git.subcommand, git.args)) return null;
  return refusal(`a review agent may only run read-only git commands in the repo it reviews, not \`git ${git.subcommand}\``);
}

/** The GIT_* variable set for this part or by an earlier part of the call, or null. */
function gitVariable(part: CommandPart, earlier: readonly CommandPart[]): string | null {
  for (const p of [...earlier, part]) {
    const assigned = p.assignments.find((name) => name.startsWith('GIT_'));
    if (assigned !== undefined) return assigned;
    if (p.program !== null && VARIABLE_SETTERS.has(p.program)) {
      const named = p.words.slice(1).find((w) => w.startsWith('GIT_'));
      if (named !== undefined) return named.split('=')[0];
    }
  }
  return null;
}

/** True when the part changes the installed dependencies of a reviewed repo. */
function changesDependencies(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  if (part.words.length === 2 && (part.words[1] === '--version' || part.words[1] === '-v')) return false;
  const command = packageCommand(part);
  if (command === null || !changesInstalled(command)) return false;
  const dirs = optionValues(command.words, PACKAGE_DIR_OPTIONS).map((d) => absolute(d, part.cwd, scope.home));
  return runsInRepo(part, dirs, scope, paths, caseInsensitive);
}

/** The operands of `ln` (its non-option words, and an option's `=value`), as absolute paths. */
function lnOperands(part: CommandPart, home: string): string[] {
  let options = true;
  return part.words.slice(1).flatMap((word) => {
    if (options && word === '--') {
      options = false;
      return [];
    }
    if (options && word.startsWith('-')) return word.includes('=') ? [word.slice(word.indexOf('=') + 1)] : [];
    return [word];
  }).map((word) => absolute(word, part.cwd, home));
}

/** The words of the part read as paths: operands, option values (`--x=v`, `-Cv`), and command strings it hands on (null: can't be read as paths). */
function pathWords(part: CommandPart, home: string): string[] | null {
  const words: string[] = [];
  for (const word of part.words.slice(1)) {
    if (COMMAND_STRING.test(word)) return null;
    if (!word.startsWith('-')) words.push(word);
    else if (word.includes('=')) words.push(word.slice(word.indexOf('=') + 1));
    else if (!word.startsWith('--') && word.length > 2) words.push(word.slice(2));
  }
  return words.map((w) => absolute(w, part.cwd, home));
}

/**
 * True when the part runs entirely outside the reviewed repos: its folder is known and exists, its
 * folder, git folder, write targets and every path word (operands, option values) are outside them
 * and the user-level files (round 5, sec H5),
 * it hands no command string on, and nothing earlier in the call set HOME, ran eval or source, or made a link.
 */
function runsOutsideRepos(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean, earlier: readonly CommandPart[]): boolean {
  if (part.lostDir !== null || !scope.exists(part.cwd)) return false;
  if ([...earlier, part].some((p) => MOVES_UNSEEN.has(p.program ?? '') || p.assignments.includes('HOME') || riskyAssignment(p) !== null)) return false;
  const words = pathWords(part, scope.home);
  if (words === null) return false;
  const places = [part.cwd, ...(part.git === null ? [] : [part.git.dir]), ...words, ...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs];
  // round 6 (user choice 2): the sandbox sits in the temp folders
  return places.every((p) => inTemp(p, scope, paths, caseInsensitive));
}

/** True when the program, or the script an interpreter runs, is not written out in full. */
function programNotLiteral(part: CommandPart): boolean {
  const script = scriptArgument(part);
  return [part.program, script].some((word) => word !== null && (word.includes(UNKNOWN) || part.globs.has(word)));
}

/** True when the program, or the script an interpreter runs, is one of the review check's entry points. */
function runsReviewCheck(part: CommandPart, home: string, paths: PathResolver): boolean {
  return [part.program, scriptArgument(part)].some((word) => {
    if (word === null) return false;
    const file = absolute(word, part.cwd, home);
    return [file, paths.realpath(file)].some((p) => REVIEW_CHECK_FILES.has(path.posix.basename(p)));
  });
}

/** The refusal for an offloader call under any name but the caller's own, or null. */
function checkOffload(part: CommandPart, agent: string): Refusal | null {
  if (!part.words.some((w) => OFFLOADER.test(w))) return null;
  const named = optionValues(part.words, ['--agent']);
  const own = agent.slice(agent.lastIndexOf(':') + 1);
  if (named.length === 1 && !named[0].includes(UNKNOWN) && isGateAgent(named[0], [own])) return null;
  return refusal('a review agent may not offload under another agent\'s name; offload once, under its own name');
}

/**
 * The reviewPrograms entry the part runs, or null. An entry is a program, by name (found on PATH)
 * or by path (`~` is the home folder), optionally followed by the words the call must start with
 * (`ruff check`, `black --check`). A program run by path from inside a reviewed repo (./gradlew,
 * vendor/bin/phpunit) is matched by its name.
 */
function namedEntry(part: CommandPart, settings: GateSettings, scope: ReviewScope, inRepo: boolean): string[] | null {
  const { program, name } = part;
  if (program === null || name === null) return null;
  for (const entry of settings.reviewPrograms ?? []) {
    const [first = '', ...rest] = entry.split(' ').filter((w) => w !== '');
    const runs = first.includes('/')
      ? absolute(first, '/', scope.home) === absolute(program, part.cwd, scope.home)
      : first === name && (!program.includes('/') || inRepo);
    if (runs && entryWordsMatch(part, rest)) return [first, ...rest];
  }
  return null;
}

/**
 * True when the call has an entry's words: its subcommand words as the call's first non-option
 * words, in order (options and the values of known value-taking options skipped), and its option
 * words anywhere. An interpreter's entry (`php -l`) is matched word for word from the start: a
 * word after a script file is the script's own.
 */
function entryWordsMatch(part: CommandPart, entryWords: readonly string[]): boolean {
  const args = part.words.slice(1);
  if (isInterpreter(part.name)) return entryWords.every((word, i) => args[i] === word);
  const subcommands = entryWords.filter((w) => !w.startsWith('-'));
  const operands = positionals(args, valueOptionsOf(part.name ?? ''));
  // `cargo audit fix`: a bare word after the entry's own is another subcommand; a path is an operand
  const extra = NO_EXTRA_SUBCOMMANDS.has(part.name ?? '') && operands.slice(subcommands.length).some((w) => !/[./]/.test(w));
  return (
    !extra &&
    subcommands.every((word, i) => operands[i] === word) &&
    entryWords.filter((w) => w.startsWith('-')).every((option) => args.some((w) => w === option || optionName(w) === option))
  );
}

/** Programs whose subcommands take subcommands of their own: an entry's call may add paths, never another subcommand word. */
const NO_EXTRA_SUBCOMMANDS = new Set(['cargo', 'go', 'rustc', 'dotnet', 'swift', 'terraform']);

/** True when the part uses an option the reviewWriteOptions setting names (for any program, or `prog -x` for that one). */
function writeOption(part: CommandPart, settings: GateSettings): boolean {
  const args = part.words.slice(1);
  const singleDash = SINGLE_DASH_LONG.has(part.name ?? '');
  // go and its kind read `--flag` as `-flag`
  const dashed = (word: string): string => optionName(word).replace(/^--/, '-');
  return (settings.reviewWriteOptions ?? []).some((entry) => {
    const [first = '', option] = entry.split(' ');
    if (option === undefined) return args.some((w) => longOptionMatch(w, first));
    if (first !== part.name) return false;
    if (singleDash) return args.some((w) => dashed(w) === dashed(option));
    // a one-letter option also counts inside a cluster (`-no`) or with its value attached (`-ofile`);
    // a long one also shortened (`--outp` for `--output`)
    if (!/^-[A-Za-z0-9]$/.test(option)) return args.some((w) => longOptionMatch(w, option, GETOPT_PROGRAMS.has(part.name ?? '') ? 1 : 3));
    return args.some((w) => !w.startsWith('--') && new RegExp(`^-[A-Za-z0-9]*${option.slice(1)}`).test(w));
  });
}

/** True when an inner program (run by `find -exec` or `xargs`) is a plain reviewPrograms name. */
function plainNamed(word: string, settings: GateSettings): boolean {
  return !word.includes('/') && (settings.reviewPrograms ?? []).includes(word) && word !== 'find';
}

/** Runners that run a package's program, and their options that fetch or run something else. */
const PACKAGE_RUNNERS = new Set(['npx', 'bunx']);
const RUNNER_EXEC_OPTIONS = new Set(['-p', '--package', '-c', '--call']);
/** Runners that run the program named after their subcommand: `poetry run x`, `bundle exec x`. */
const SUBCOMMAND_RUNNERS = new Map([['poetry', 'run'], ['pipenv', 'run'], ['bundle', 'exec'], ['uv', 'run']]);
/** `uv run` options that keep it from syncing the lock file and the environment, and the others it may take. */
const UV_NO_SYNC = new Set(['--frozen', '--no-sync']);
const UV_QUIET = new Set(['--offline', '-q', '--quiet']);

/** What a runner runs: the words it runs, `refused` when the runner form itself may not run, or null for no runner. */
type Runner = { words: string[] } | { refused: string } | null;

/**
 * True when a package runner may run the package: a plugin-chosen package, a test runner, the
 * repo's own (node_modules/.bin), or a JS tool the gate knows. A runner that fetches what is
 * missing (npx, bunx, npm exec) runs a JS tool only when the repo has it or with --no-install: on
 * npm, a tool's name can be another package (round 5, CR H2).
 */
function packageAllowed(runner: string, tool: string, settings: GateSettings, scope: ReviewScope, fetchesMissing: boolean, cwd: string): boolean {
  if (tool.includes('/')) return false;
  const installed = binFolders(cwd, scope).some((dir) => scope.exists(path.join(dir, tool)));
  return (
    (isJsTool(tool) && (!fetchesMissing || installed)) ||
    (settings.reviewNpxPackages ?? []).includes(tool) ||
    settings.testCommandPatterns.includes(`${runner} ${tool}`) ||
    installed
  );
}

/**
 * The node_modules/.bin folders npx looks in: from the working folder up to the top of the reviewed
 * repo it is in, and each repo's top (round 6, CR L3).
 */
function binFolders(cwd: string, scope: ReviewScope): string[] {
  const folders = scope.repos.map((repo) => path.join(repo, 'node_modules', '.bin'));
  const repo = cwd.includes(UNKNOWN) ? undefined : scope.repos.find((r) => isSameOrAncestor(r, cwd, false));
  if (repo === undefined) return folders;
  for (let dir = cwd; dir !== repo && dir !== path.dirname(dir); dir = path.dirname(dir)) folders.push(path.join(dir, 'node_modules', '.bin'));
  return folders;
}

/** Runners that fetch a package that isn't installed. */
const FETCHING_RUNNERS = new Set(['npx', 'bunx', 'npm exec', 'npm x']);

/** The words after a package runner's own options (`--` ends them); refused on an option that installs or runs something else. */
function afterRunnerOptions(runner: string, args: readonly string[], settings: GateSettings, scope: ReviewScope, cwd: string): Runner {
  const at = args.findIndex((w) => !w.startsWith('-') || w === '--');
  if (args.slice(0, at === -1 ? args.length : at).some((w) => RUNNER_EXEC_OPTIONS.has(optionName(w)))) return { refused: `${runner} -p` };
  const words = args.slice(at === -1 ? args.length : args[at] === '--' ? at + 1 : at);
  const [tool] = words;
  const fetches = FETCHING_RUNNERS.has(runner) && !args.slice(0, at === -1 ? args.length : at).includes('--no-install');
  if (tool === undefined || !packageAllowed(runner === 'bunx' ? 'bunx' : 'npx', tool, settings, scope, fetches, cwd)) return { refused: `${runner} ${tool ?? ''}` };
  return { words };
}

/** What the part runs when it is a runner (npx, `uv run`, `python -m`, `yarn <tool>` …). */
function runnerOf(part: CommandPart, settings: GateSettings, scope: ReviewScope): Runner {
  const { name, words } = part;
  if (name === null) return null;
  const args = words.slice(1);
  if (/^python[0-9.]*$/.test(name) && args[0] === '-m') {
    const module = args[1];
    if (module === undefined || module.includes('/')) return { refused: `${name} -m` };
    // a module test run the plugin names (unittest); any other module runs as its program
    if (settings.testCommandPatterns.some((p) => matchCommand(p, part.words))) return module === 'unittest' ? { words: [] } : { words: [module.replaceAll('_', '-'), ...args.slice(2)] };
    return { words: [module.replaceAll('_', '-'), ...args.slice(2)] };
  }
  if (PACKAGE_RUNNERS.has(name)) return afterRunnerOptions(name, args, settings, scope, part.cwd);
  const [first] = positionals(args, valueOptionsOf(name));
  const after = first === undefined ? [] : args.slice(args.indexOf(first) + 1);
  if ((name === 'npm' && (first === 'exec' || first === 'x')) || ((name === 'pnpm' || name === 'yarn') && first === 'exec')) {
    return afterRunnerOptions(`${name} ${first}`, after, settings, scope, part.cwd);
  }
  if ((name === 'pnpm' || name === 'yarn') && first !== undefined && !scriptRun(first) && packageAllowed(name, first, settings, scope, false, part.cwd) && !(settings.reviewNpxPackages ?? []).includes(first)) {
    return { words: [first, ...after] };
  }
  const sub = SUBCOMMAND_RUNNERS.get(name);
  if (sub === undefined || args[0] !== sub) return null;
  let rest = args.slice(1);
  if (name === 'uv') {
    const options = rest.slice(0, Math.max(0, rest.findIndex((w) => !w.startsWith('-'))));
    // `uv run` syncs uv.lock and .venv first unless told not to
    if (!options.some((w) => UV_NO_SYNC.has(w)) || !options.every((w) => UV_NO_SYNC.has(w) || UV_QUIET.has(w))) return { refused: 'uv run (without --frozen or --no-sync)' };
    rest = rest.slice(options.length);
  }
  return rest[0] === undefined || rest[0].startsWith('-') ? { refused: `${name} ${sub}` } : { words: rest };
}

/** A word as a shell word that means exactly itself. */
function shellWord(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** Options of the wrappers a review agent may use that write or move where the program runs. */
const WRAPPER_WRITES = new Map<string, RegExp>([
  ['time', /^(?:-[A-Za-z]*[oa]|--output|--append)/],
  ['env', /^(?:-[A-Za-z]*[CS]|--chdir|--split-string)/],
]);

/** True when a wrapper the part runs under writes a file or moves the program (`time -o f`, `env -C dir`). */
function wrapperWrites(part: CommandPart): boolean {
  return part.wrappers.some((w, i) => {
    const writes = WRAPPER_WRITES.get(w);
    return writes !== undefined && (part.wrapperOptions[i] ?? []).some((o) => writes.test(o));
  });
}

/** Where mktemp makes its file or folder: each template in the folder given (-p, --tmpdir) or the current one; the temp folder when none. */
function mktempTargets(part: CommandPart, home: string): string[] {
  const args = part.words.slice(1);
  const dirs = optionValues(args, ['-p', '--tmpdir']);
  const templates = positionals(args, new Set(['-p', '--tmpdir', '-t', '--suffix']));
  const base = dirs[0] ?? part.cwd;
  return [...dirs.map((d) => absolute(d, part.cwd, home)), ...templates.map((t) => absolute(t, absolute(base, part.cwd, home), home))];
}

/** Write forms the reviewWriteOptions setting can't name: report options by pattern, output folders in the repo, javac's class files. */
function toolWrites(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  const args = part.words.slice(1);
  const into = (values: string[]): boolean => values.some((v) => !inTemp(absolute(v, part.cwd, scope.home), scope, paths, caseInsensitive));
  // an html reporter (playwright's, vitest's …) writes its report folder in the repo (round 8, MEDIUM-2)
  if (optionValues(args, ['--reporter']).some((v) => v.split(',').includes('html'))) return true;
  switch (part.name) {
    case 'mypy':
      return args.some((w) => /^--[a-z-]+-report$/.test(optionName(w)));
    case 'golangci-lint':
      return args.some((w) => optionName(w).startsWith('--output.')) || optionValues(args, ['--out-format']).some((v) => v.includes(':'));
    case 'xcodebuild':
      return into(optionValues(args, ['-resultBundlePath', '-derivedDataPath', '-archivePath', '-exportPath']));
    case 'staticcheck': {
      // -debug.cpuprofile, -debug.memprofile, -debug.trace … write where they say: `=value` in temp only
      const debug = args.filter((w) => /^--?debug\./.test(w));
      return debug.some((w) => !w.includes('=')) || into(debug.map((w) => w.slice(w.indexOf('=') + 1)));
    }
    case 'dotnet':
      // -bl / -binaryLogger writes a build log (msbuild.binlog in the folder when no file is given)
      return args.some((w) => /^[-/](?:bl|binarylogger)(?::|$)/i.test(w) && (!w.includes(':') || into([w.slice(w.indexOf(':') + 1)])));
    case 'mvn':
    case 'mvnw':
      // exec-maven-plugin settings name a program to run
      return args.some((w) => /^-Dexec\./.test(w)) || optionValues(args, ['-D']).some((v) => v.startsWith('exec.'));
    case 'javac': {
      // javac writes its class files next to the sources unless -d says where
      const out = optionValues(args, ['-d', '-s', '-h']);
      return !args.includes('-d') || into(out) || args.some((w) => ['-processorpath', '--processor-module-path', '-processor', '--processor-path'].includes(w) || w.startsWith('-Xplugin'));
    }
    default:
      return false;
  }
}

/** The refusal for a part off the review allowlist, or null. */
function checkAllowlist(part: CommandPart, agent: string, settings: GateSettings, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): Refusal | null {
  if (part.program === null) return null;
  const offList = (what: string): Refusal =>
    refusal(
      `\`${what}\` is not on the review allowlist (the plugin's reviewPrograms setting in config/tool-gates.json, plus git and gh read forms, test runs, builds, lint and type checks); a user can add a program under toolGates.reviewPrograms in ~/.oss/config.json`,
    );
  const wrapper = part.wrappers.find((w) => !ALLOWED_WRAPPERS.has(w));
  if (wrapper !== undefined) return offList(wrapper);
  if (wrapperWrites(part)) return offList(part.wrappers.join(' '));
  const script = changingScriptRun(part.name ?? '', part.words.slice(1));
  if (script !== null) return refusal(`a review agent may not run the package script \`${script}\` (its name says it changes things: deploy, publish, release, migrate, seed or fix)`);
  if (part.wrappers.includes('xargs') && (!plainNamed(part.program, settings) || BY_WORD_COUNT.has(part.name ?? ''))) return offList(`xargs ${part.program}`);
  const inRepo = part.program.includes('/') && insideRepo(absolute(part.program, part.cwd, scope.home), scope.repos, paths, caseInsensitive);
  if (toolWrites(part, scope, paths, caseInsensitive)) return offList(part.words.slice(0, 2).join(' '));
  // a test run or build runs the repo's own code and config: from the repo, with every path in it (round 5, sec H4)
  if (runsRepoCode(part, settings) && !staysInRepo(part, scope, paths, caseInsensitive)) {
    return refusal(`a review agent may run \`${part.words.slice(0, 2).join(' ')}\` only from the repo it reviews, with every path and config it names inside that repo`);
  }
  // a build tool runs every goal it is given: each must build, check or test
  const goals = goalsAllowed(part.name ?? '', part.words.slice(1));
  if (goals !== null && (settings.reviewPrograms ?? []).some((e) => e.split(' ')[0] === part.name) && (!part.program.includes('/') || inRepo)) {
    return goals && !writeOption(part, settings) ? null : offList(part.words.slice(0, 3).join(' '));
  }
  if (part.name === 'mktemp') return mktempTargets(part, scope.home).some((p) => !inTemp(p, scope, paths, caseInsensitive)) ? offList('mktemp') : null;
  const entry = namedEntry(part, settings, scope, inRepo);
  if (entry !== null) {
    const misused = namedProgramMisused(part) || writeOption(part, settings);
    return misused ? offList(part.words.slice(0, entry.length + 1).join(' ')) : null;
  }
  // a program given by path runs whatever is there: only the reviewed repo's own (node_modules/.bin, ./gradlew)
  if (part.program.includes('/') && !inRepo) return offList(part.program);

  if (knownForm(part, settings.testCommandPatterns, matchCommand) && !writeOption(part, settings)) return null;
  if (part.name === 'kill') return isGateAgent(agent, settings.backgroundAgents ?? []) && ownJobs(part.words.slice(1), UNKNOWN) ? null : offList('kill');
  const form = interpreterForm(part);
  // `node -r x.js`: a preload runs first, whatever the form
  if (form !== null && writeOption(part, settings)) return offList(part.words.slice(0, 2).join(' '));
  if (form === 'inline') {
    if (scope.fallback !== true) return nodeTestRun(part) ? checkNodeTestFiles(part, scope, paths, caseInsensitive) : null;
    return nodeTestRun(part) ? checkNodeTestFallback(part, scope, paths, caseInsensitive) : NO_SANDBOX;
  }
  if (form === 'script') {
    // a script file the gate can see: one that exists, in the reviewed repo (the pen tester: anywhere
    // when the sandbox holds it; in the reviewed repo too when there is none)
    const file = absolute(scriptArgument(part) ?? '', part.cwd, scope.home);
    const inRepoFile = insideRepo(file, scope.repos, paths, caseInsensitive);
    if (scope.fallback === true && !inRepoFile) return NO_SANDBOX;
    const where = isGateAgent(agent, settings.backgroundAgents ?? []) || inRepoFile;
    return where && scope.exists(file) ? null : offList(`${part.program} ${scriptArgument(part) ?? ''}`);
  }
  // round 10, CR LOW-2: a known JS tool refused as written is named with the form that runs
  if (isJsTool(part.name ?? '')) {
    const name = part.name ?? '';
    const form = name === 'tsc' ? `${name} --noEmit` : name;
    return refusal(
      `\`${part.words.slice(0, 2).join(' ')}\` is not on the review allowlist: a review agent runs ${name} only to check, never to write files; run the repo's own copy as \`npx --no-install ${form} …\` or \`node_modules/.bin/${form} …\``,
    );
  }
  return offList(part.program);
}

/** `node --test`: the repo's own tests, a test run rather than inline code. */
function nodeTestRun(part: CommandPart): boolean {
  return (part.name === 'node' || part.name === 'nodejs') && part.words.slice(1).some((w) => optionName(w) === '--test') && !part.words.slice(1).some((w) => ['-e', '--eval', '-p', '--print'].includes(optionName(w)));
}

/** `node --test` options that take a value as the next word. */
const NODE_TEST_VALUES = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--test-shard', '--test-isolation', '--test-coverage-include', '--test-coverage-exclude', '--cpu-prof-dir', '--diagnostic-dir', '--heap-prof-dir']);
/** Options `node --test` may take with no sandbox: test selection and reporting, nothing that loads code. */
const NODE_TEST_OPTIONS = new Set([...NODE_TEST_VALUES, '--test', '--test-only', '--test-force-exit', '--experimental-test-coverage', '--test-update-snapshots', '--enable-source-maps', '--no-warnings', '--experimental-strip-types', '--experimental-test-module-mocks', '--test-coverage-branches', '--test-coverage-functions', '--test-coverage-lines', '--cpu-prof', '--heap-prof']);
/** node's own reporters: any other `--test-reporter` value is a module it loads. */
const NODE_REPORTERS = new Set(['spec', 'tap', 'dot', 'junit', 'lcov']);
/** `node --test` options that name where it writes. */
const NODE_TEST_OUTPUTS = ['--test-reporter-destination', '--cpu-prof-dir', '--diagnostic-dir', '--heap-prof-dir'];

/**
 * With no OS sandbox, `node --test` runs only the reviewed repo's own tests (round 9, CR HIGH-2, SEC
 * HIGH-3): from the repo, every test path and coverage glob in it, only options that select and report
 * (no `--import`, `--require`, loader, env file or watch mode, no reporter module), and its profile,
 * diagnostic and reporter files in temp.
 */
function checkNodeTestFallback(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): Refusal | null {
  const args = part.words.slice(1);
  const refused = refusal('with no OS sandbox, a review agent may run `node --test` only on the repo\'s own tests, from the repo, with test selection and reporting options only (no --import, --require, loader, env file, watch mode or reporter module), writing reports only to the temp folders');
  if (part.cwd.includes(UNKNOWN) || !insideRepo(part.cwd, scope.repos, paths, caseInsensitive)) return refused;
  if (args.some((w) => w.startsWith('-') && w !== '-' && !NODE_TEST_OPTIONS.has(optionName(w)))) return refused;
  if (optionValues(args, ['--test-reporter']).some((r) => !NODE_REPORTERS.has(r))) return refused;
  // round 10, SEC LOW-1: profiles go to a folder named in temp, never the repo; snapshots are never updated
  const given = (names: readonly string[]): boolean => args.some((w) => names.includes(optionName(w)));
  if (given(['--test-update-snapshots'])) return refused;
  if (given(['--cpu-prof']) && !given(['--cpu-prof-dir', '--diagnostic-dir'])) return refused;
  if (given(['--heap-prof']) && !given(['--heap-prof-dir', '--diagnostic-dir'])) return refused;
  const outputs = optionValues(args, NODE_TEST_OUTPUTS).filter((v) => v !== 'stdout' && v !== 'stderr');
  if (outputs.some((v) => !inTemp(absolute(v, part.cwd, scope.home), scope, paths, caseInsensitive))) return refused;
  const inRepo = (w: string): boolean => !w.includes(UNKNOWN) && insideRepo(absolute(w, part.cwd, scope.home), scope.repos, paths, caseInsensitive);
  const operands = [...positionals(args, NODE_TEST_VALUES), ...optionValues(args, ['--test-coverage-include', '--test-coverage-exclude'])];
  return operands.every(inRepo) ? null : refused;
}

/** In the sandbox, `node --test` runs only test files in the reviewed repos (round 11, SEC CRITICAL-1). */
function checkNodeTestFiles(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): Refusal | null {
  const files = positionals(part.words.slice(1), NODE_TEST_VALUES).map((w) => absolute(w, part.cwd, scope.home));
  return files.every((f) => insideRepo(f, scope.repos, paths, caseInsensitive) && !f.includes(UNKNOWN)) ? null : refusal('a review agent may run `node --test` only on test files in the repo it reviews');
}

/** The refusal for inline code or a script outside the repo where no OS sandbox holds the call (round 8, D4). */
const NO_SANDBOX = refusal(
  'with no OS sandbox on this machine, a review agent may not run inline code (python -c, node -e, bash -c …) or a script outside the repo it reviews; run the repo\'s own checks and scripts, or report what you need to the main agent',
);

/** Container and cluster tools (round 9, D-R9-5): their sockets and logins are closed in the macOS review sandbox. */
const CONTAINER_TOOLS: ReadonlySet<string> = new Set(['docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'k9s']);

/** The `xcodebuild` forms that only ask (list, version, settings): every other one builds. */
const XCODEBUILD_QUERIES = new Set(['-list', '-version', '-showBuildSettings', '-showsdks', '-showdestinations', '-help', '-usage']);

/**
 * True for a Swift, JVM/Gradle or .NET build or test run (round 9, D-R9-3): their toolchains keep
 * state in the home folder the macOS review sandbox can't read or write.
 */
function unbuildableStack(part: CommandPart): boolean {
  const name = part.name ?? '';
  const args = part.words.slice(1);
  if (['mvn', 'mvnw', 'gradle', 'gradlew'].includes(name)) return true;
  if (name === 'swift') return ['build', 'test', 'run'].includes(args[0] ?? '');
  if (name === 'dotnet') return ['build', 'test', 'run'].includes(args[0] ?? '');
  if (name === 'xcodebuild') return !args.some((w) => XCODEBUILD_QUERIES.has(w));
  return false;
}

/** Where `git init` / `git clone` make a repo: the folder named, else the folder git runs in (clone: a new folder in it). */
function gitCreates(git: NonNullable<CommandPart['git']>, home: string): string[] {
  const named = git.args.filter((w) => !w.startsWith('-'));
  const options = optionValues(git.args, ['--separate-git-dir', '--template']);
  if (git.subcommand === 'init') return [...(named.length > 0 ? named.slice(0, 1) : ['.']), ...options].map((w) => absolute(w, git.dir, home));
  if (git.subcommand !== 'clone') return [];
  const into = named[1] ?? path.posix.basename(named[0] ?? '').replace(/\.git$/, '');
  return [into, ...options].map((w) => absolute(w, git.dir, home));
}

/**
 * The agent file's placeholder for the offload prompt path, and the paths `mktemp -d -t oss-offload.XXXXXX`
 * makes under any absolute temp folder (macOS adds a `.random` suffix, round 5, CR M1); `/../` is refused.
 */
const PROMPT_PLACEHOLDER = "'<path printed in step 1>'";
const PROMPT_PATH = "'((?:/[A-Za-z0-9_.+-]+)+)/(oss-offload\\.[A-Za-z0-9.]+)/prompt\\.md'";

/** A block's lines as compared: each trimmed, blank and comment lines dropped. */
function setupLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
}

/** The file name of the calling agent's own agent file (`<name>.md`), or null for the main agent or a name that is no file name. */
export function ownAgentFile(agent: string | undefined): string | null {
  if (agent === undefined) return null;
  const bare = agent.slice(agent.lastIndexOf(':') + 1).trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(bare) ? `${bare}.md` : null;
}

/**
 * True when the call is, line for line, one of the bash blocks of the caller's own agent file (the
 * setup steps: model check, key check, decrypt, offload), the offload prompt path filled in with a
 * path `mktemp -d -t oss-offload.XXXXXX` makes in a temp folder, not in `excluded` (the reviewed repos
 * and the home folder, round 6, CR I3). The agent file is the plugin's own (read from the
 * folder the gate runs from), so the block runs only the plugin's own scripts, as the caller.
 */
export function isOwnSetupStep(
  command: string,
  agentFileText: string,
  temp: readonly string[],
  excluded: readonly string[] = [],
  folderSafe: (folder: string) => boolean = () => true,
): boolean {
  const call = setupLines(command);
  for (const match of agentFileText.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)) {
    const block = setupLines(match[2] ?? '');
    if (block.length !== call.length) continue;
    const same = block.every((line, i) => {
      const at = line.indexOf(PROMPT_PLACEHOLDER);
      if (at === -1) return line === call[i];
      const shape = new RegExp(`^${escapeRegExp(line.slice(0, at))}${PROMPT_PATH}${escapeRegExp(line.slice(at + PROMPT_PLACEHOLDER.length))}$`);
      const found = shape.exec(call[i] ?? '');
      // round 6 (CR I3): the folder mktemp made sits in a temp folder
      const folder = found?.[1];
      return (
        folder !== undefined &&
        !(call[i] ?? '').includes('/../') &&
        temp.some((root) => isSameOrAncestor(root, folder, false)) &&
        !excluded.some((place) => isSameOrAncestor(place, folder, false)) &&
        folderSafe(`${folder}/${found?.[2] ?? ''}`)
      );
    });
    if (same) return true;
  }
  return false;
}

/**
 * True when the offload prompt folder is one `mktemp -d` made for this user (round 9, SEC MEDIUM-1):
 * directly in a temp folder, no link anywhere below that temp folder, a real folder owned by the user
 * with mode 0700, and its prompt.md (when there) a regular file of the user's with one link, so the
 * offloader can't be pointed at a credential file through a symlink or a hard link.
 */
export function offloadFolderSafe(folder: string, temp: readonly string[]): boolean {
  const parent = path.dirname(folder);
  if (!temp.includes(parent)) return false;
  try {
    const uid = process.getuid?.();
    const dir = fs.lstatSync(folder);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== uid || (dir.mode & 0o777) !== 0o700) return false;
    if (fs.realpathSync(folder) !== path.join(fs.realpathSync(parent), path.basename(folder))) return false;
    const prompt = fs.lstatSync(path.join(folder, 'prompt.md'), { throwIfNoEntry: false });
    return prompt === undefined || (prompt.isFile() && prompt.uid === uid && prompt.nlink === 1);
  } catch {
    return false;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Refusal for a call the command reader could not read in full: a review agent's call must be read whole. */
export function checkGateAgentUnreadable(agent: string | undefined, settings: GateSettings, reason: string): Refusal | null {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  return refusal(`a review agent's command must be read in full by the gate, and part of this one can't be (${reason}); write it out without variables standing for programs or scripts`);
}

/** Refusal for what only the command text shows: a `for`/`select` loop setting a risky variable. */
export function checkGateAgentCommand(agent: string | undefined, settings: GateSettings, command: string): Refusal | null {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  const variable = riskyLoopVariable(command) ?? riskyExpansionVariable(command);
  return variable === null ? null : refusal(`a review agent may not set \`${variable}\` (it changes what runs or where)`);
}

export function checkGateAgentBash(
  part: CommandPart,
  agent: string | undefined,
  settings: GateSettings,
  scope: ReviewScope,
  paths: PathResolver,
  caseInsensitive = false,
  call: BashCall = {},
): Refusal | null {
  const earlier = call.earlier ?? [];
  if (agent === undefined || !isGateAgent(agent, settings.gateAgents)) return null;
  // only words that reach path work are capped (round 8, LOW-3): a long message or pattern is fine
  if ([part.program ?? '', ...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs].some((w) => w.length > MAX_WORD)) {
    return refusal(`a review agent may not write to a path over ${MAX_WORD} characters; to keep long text, write it to a temp file with a heredoc (cat > /tmp/notes.md <<'EOF' … EOF)`);
  }
  if (programNotLiteral(part)) {
    return refusal('a review agent may only run programs named in full, not from a variable, `$( … )` or a wildcard');
  }
  if (part.lostDir !== null) {
    return refusal(`a review agent may not run a command in a folder only known when it runs (after \`${part.lostDir.why}\`)`);
  }
  const risky = riskyAssignment(part);
  if (risky !== null) return refusal(`a review agent may not set \`${risky}\` (it changes what runs or where)`);
  if (setterNameNotLiteral(part, UNKNOWN)) return refusal('a review agent may only set variables named in full, not from a variable or `$( … )`');
  const sandbox = isGateAgent(agent, settings.backgroundAgents ?? []) && runsOutsideRepos(part, scope, paths, caseInsensitive, earlier);
  // a call run in the background runs every part there, but `cd` only moves the shell
  const launch = call.background === true && !FOLDER_MOVES.has(part.program ?? '') ? 'background' : launchOf(part);
  if (launch !== null && !(launch === 'background' && sandbox)) {
    return refusal('a review agent may not start work that outlives its run (a background job, nohup, tmux, ssh -f, a detached container, brew services, a nested claude session …)');
  }
  if (runsReviewCheck(part, scope.home, paths)) return refusal('a review agent may not run the review check itself');
  if (scope.darwin === true && unbuildableStack(part)) return refusal("this stack's build and tests can't run in the review sandbox; review the code by reading it");
  if (scope.darwin === true && CONTAINER_TOOLS.has(part.name ?? '')) return refusal("docker/kubectl can't run in the review sandbox; review the files (Dockerfile, compose, manifests) instead");
  if (scope.sandboxed === true && part.name === 'gh') return refusal("gh can't read its login inside the review sandbox; ask the main agent for what you need from GitHub");
  const variable = part.git === null ? null : gitVariable(part, earlier);
  if (variable !== null) {
    return refusal(`a review agent may not run git with \`${variable}\` set in the same call; run git without GIT_* variables`);
  }
  if (part.git !== null && gitCreates(part.git, scope.home).some((p) => !inTemp(p, scope, paths, caseInsensitive))) {
    return refusal('a review agent may make a git repo only in the temp folders (/tmp or the session temp folder, written out in full)');
  }
  const git = checkGit(part, scope, paths, caseInsensitive);
  if (git !== null) return git;
  if (gitByOtherName(part) && runsInRepo(part, [], scope, paths, caseInsensitive)) {
    return refusal(`a review agent may only run read-only git commands in the repo it reviews, not \`${part.name ?? ''}\``);
  }
  if (part.name === 'gh' && !readOnlyGh(part.words.slice(1))) {
    return refusal('a review agent may only run read-only gh commands (pr view/list/diff/checks/status, issue view/list, run view/list, api GET)');
  }
  if (changesDependencies(part, scope, paths, caseInsensitive)) {
    return refusal('a review agent may not change the reviewed repo\'s installed dependencies');
  }
  if (part.name === 'ln' && lnOperands(part, scope.home).some((p) => !inTemp(p, scope, paths, caseInsensitive))) {
    return refusal('a review agent may link only files in the temp folders (/tmp or the session temp folder, written out in full); a link elsewhere would let a write change what it points at');
  }
  const offload = checkOffload(part, agent);
  if (offload !== null) return offload;
  if (tarEscapes(part)) return refusal('a review agent may not unpack with absolute names or renamed paths (tar -P, --insecure, -s, --transform), which writes wherever the archive says');
  const mkdirs = part.name === 'mkdir' ? part.words.slice(1).filter((w) => !w.startsWith('-')).map((w) => absolute(w, part.cwd, scope.home)) : [];
  const writes = [...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs, ...mkdirs, ...extractTargets(part, scope.home)];
  if (writes.length > 0 && uncertainFolderMove(earlier)) {
    return refusal('a review agent may not write after a `cd`, `pushd` or `popd` that may fail (the folder it writes in is then not known); join them with `&&`, or write the path out in full');
  }
  const copied = writes.find((target) => copiedFolders(earlier, scope.home).some((dest) => isSameOrAncestor(dest, target, caseInsensitive) && dest !== target));
  if (copied !== undefined) {
    return refusal(`a review agent may not write under a folder copied earlier in the same call (\`${copied}\`): a copied link there could lead anywhere`);
  }
  for (const target of writes) {
    if (target.includes(UNKNOWN)) {
      return refusal('a review agent may not write a path only known when the command runs; write the path out in full');
    }
    if (!inTemp(target, scope, paths, caseInsensitive)) {
      return refusal(`a review agent may write only in the temp folders (/tmp or the session temp folder, written out in full), not \`${target}\``);
    }
  }
  const output = [...outputValues(part, scope.home), ...variablePaths(part, scope.home)].find((p) => !inTemp(p, scope, paths, caseInsensitive));
  if (output !== undefined) {
    return refusal(`a review agent may point output, cache and report paths only at the temp folders (/tmp or the session temp folder, written out in full), not \`${output.includes(UNKNOWN) ? 'a path only known when it runs' : output}\``);
  }
  if (sandbox) return null;
  if (namesUserFiles(part, scope, paths, caseInsensitive)) {
    return refusal('a review agent may not point a program at the user\'s own files (~/.oss, ~/.claude, ~/.config, ~/.ssh, shell start-up files …), except to read them');
  }
  const depth = call.depth ?? 0;
  const inner = { agent, settings, scope, paths, caseInsensitive, earlier: [...earlier, part], depth: depth + 1 };
  // what find -exec runs is checked as its own command, `{}` a path only known when it runs
  for (const words of findExecs(part)) {
    const refused = checkInnerCommand(words.map((w) => (w === '{}' ? '"$OSS_FIND_PATH"' : shellWord(w))).join(' '), part, 'find -exec', inner);
    if (refused !== null) return refused;
  }
  // a runner (npx, `uv run`, `python -m` …) is judged by the program it runs, read as its own command
  if (/^python[0-9.]*$/.test(part.name ?? '') && part.words[1] === '-m' && !staysInRepo(part, scope, paths, caseInsensitive)) {
    return refusal('a review agent may run `python -m` only from the repo it reviews, with every path it names inside that repo');
  }
  const runner = runnerOf(part, settings, scope);
  if (runner === null) return checkAllowlist(part, agent, settings, scope, paths, caseInsensitive);
  if ('refused' in runner) {
    return refusal(
      `\`${runner.refused}\` is not on the review allowlist; a runner may run only the checks the gate knows, and a JS tool only from the repo's own node_modules/.bin or with \`npx --no-install\``,
    );
  }
  if (runner.words.length === 0) return null;
  if (runner.words.some((w) => w.includes(UNKNOWN))) return refusal('a review agent may only run programs named in full behind a runner');
  return checkInnerCommand(runner.words.map(shellWord).join(' '), part, 'a runner', inner);
}

/**
 * True when an earlier part moved the shell's folder (cd, pushd, popd) and the parts from it to here
 * don't all run only when it succeeded (`cd x; …`, `cd a || cd b`, `false && cd x; …`, `if cd x; …`):
 * the folder may then still be the old one (round 8, MEDIUM-1).
 */
function uncertainFolderMove(earlier: readonly CommandPart[]): boolean {
  return earlier.some((part, i) => FOLDER_MOVES.has(part.program ?? '') && !earlier.slice(i).every((p) => p.followedByAnd));
}

/** cp options that keep links as links (`-a`, `-P`, `-R`, `-r`, `-H`, in a cluster too) or say so in full. */
const CP_KEEPS_LINKS = /^-[A-Za-z]*[aPRrH]/;
const CP_KEEPS_LINKS_LONG = new Set(['--archive', '--recursive', '--no-dereference']);

/** The destinations of earlier `cp` parts that copy folders or keep links (round 8, LOW-1). */
function copiedFolders(earlier: readonly CommandPart[], home: string): string[] {
  return earlier.flatMap((part) => {
    if (part.name !== 'cp') return [];
    const args = part.words.slice(1);
    if (!args.some((w) => (!w.startsWith('--') && CP_KEEPS_LINKS.test(w)) || CP_KEEPS_LINKS_LONG.has(optionName(w)))) return [];
    const operands = args.filter((w) => !w.startsWith('-'));
    const dest = operands.at(-1);
    return operands.length >= 2 && dest !== undefined ? [absolute(dest, part.cwd, home)] : [];
  });
}

/** What an inner command is checked with: the caller's settings, the parts before it, and how deep it is. */
interface InnerCheck {
  agent: string;
  settings: GateSettings;
  scope: ReviewScope;
  paths: PathResolver;
  caseInsensitive: boolean;
  earlier: readonly CommandPart[];
  depth: number;
}

/** Runners and find -exec inside each other, at most this deep (round 5, perf F3). */
const MAX_INNER_DEPTH = 4;

/** The refusal for the command a runner or find -exec runs (one program, no wrapper, no write tool), checked in full; or null. */
function checkInnerCommand(text: string, part: CommandPart, by: string, check: InnerCheck): Refusal | null {
  if (check.depth > MAX_INNER_DEPTH) return refusal(`a review agent may not nest runners more than ${MAX_INNER_DEPTH} deep`);
  // a review agent's variables are never followed (round 12, CR L4)
  const inner = readCommand(text, part.cwd, check.scope.home, false, undefined, undefined, undefined, false);
  const [innerPart] = inner.parts;
  if ('unreadable' in inner || inner.parts.length !== 1 || innerPart === undefined) return refusal(`a review agent's ${by} must run one program the gate can read`);
  if (BEHIND_RUNNER_REFUSED.has(innerPart.name ?? '') || innerPart.wrappers.length > 0) {
    return refusal(`a review agent may not run \`${[...innerPart.wrappers, innerPart.name ?? ''].join(' ')}\` through ${by}`);
  }
  return checkGateAgentBash(innerPart, check.agent, check.settings, check.scope, check.paths, check.caseInsensitive, { earlier: check.earlier, depth: check.depth });
}

/** Programs a runner may never run for a review agent: the write tools and the shell's own commands. */
const BEHIND_RUNNER_REFUSED = new Set(['mkdir', 'rm', 'rmdir', 'cp', 'mv', 'touch', 'tee', 'ln', 'cd', 'pushd', 'popd', 'unset', 'set', 'export', 'git', 'gh']);

/** Long options that name where a program writes its output, cache or report (any program). */
const OUTPUT_OPTIONS = [
  '--output', '--output-file', '--output-dir', '--outdir', '--outfile', '--out-file', '--out-dir', '--report-path', '--log-file', '--cache-dir',
  '--cache-location', '--basetemp', '--junitxml', '--junit-xml',
];
/** Programs whose `-o` or `--output` is not a file (find's `or`, git's and gh's own) or is checked elsewhere. */
const OWN_OUTPUT_FORMS = new Set(['find', 'git', 'gh', 'curl']);
/** Programs whose `-o` is not a file: only-matching (grep, rg), long listing (ls), octal (od) (round 8, M2). */
const SHORT_O_NOT_FILE = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ls', 'od']);
/**
 * Long options that name where a tool writes, by their name (round 8, MEDIUM-2): any `--…output…`,
 * `--…report…` (not `--reporter`), `--…profile-…`/`--…profile-path`, and `--…-path` (not a config,
 * manifest, root or project path, which are read). A `--…format…` option is a path only after `:`.
 */
function outputNamed(name: string): boolean {
  if (!name.startsWith('--') || name === '--reporter' || name.endsWith('-reporter') || /config|manifest|root|project/.test(name)) return false;
  return /output|report|profile[-_]|-path$/.test(name);
}
/**
 * Output options a tool names with its own spelling (round 9, SEC LOW-2): go's profiles, jest's
 * coverage folder, pytest-html's report, cargo's target folder, node's report and profile folders.
 * Their values must be in temp; they are not repo paths.
 */
const TOOL_OUTPUT_OPTIONS: readonly string[] = [
  ...['-coverprofile', '-cpuprofile', '-memprofile', '-blockprofile', '-mutexprofile', '-trace', '-outputdir'].flatMap((o) => [`go ${o}`, `go -${o}`]),
  'jest --coverageDirectory',
  'jest --coverage-directory',
  'jest --outputFile',
  'pytest --html',
  'cargo --target-dir',
  'node --test-reporter-destination',
  'node --cpu-prof-dir',
  'node --diagnostic-dir',
  'node --heap-prof-dir',
];

/** The values of the part's tool-specific output options. */
function toolOutputValues(part: CommandPart): string[] {
  const prefix = `${part.name ?? ''} `;
  const options = TOOL_OUTPUT_OPTIONS.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
  return options.length === 0 ? [] : optionValues(part.words.slice(1), options).filter((v) => v !== 'stdout' && v !== 'stderr');
}

/** Too long or too many `=` to read: refused (round 6, perf C1). */
const TOO_LONG = '\u0000LONG\u0000';

/** True when an option value looks like a path: `~`, `/` or `.` first, or a `/` in it. */
function pathLike(value: string): boolean {
  return /^[~/.]/.test(value) || value.includes('/');
}

/**
 * The output, cache and report paths the part names in an option (`-o x`, `-ox`, `--output=x`,
 * `--cache-dir x`, a shortening of `--output`; in `key=value` values, the part after each `=`), as
 * absolute paths; words that don't look like paths are left out. A value too long to read, or only
 * known when it runs, is UNKNOWN.
 */
function outputValues(part: CommandPart, home: string): string[] {
  if (OWN_OUTPUT_FORMS.has(part.name ?? '')) return [];
  const args = part.words.slice(1);
  const values: { value: string; file: boolean }[] = [];
  args.forEach((word, i) => {
    tick();
    const name = optionName(word);
    const known = name.startsWith('--') && (OUTPUT_OPTIONS.includes(name) || (name.length >= 3 && '--output'.startsWith(name)));
    const named = !known && outputNamed(name);
    const long = known || named;
    const short = !word.startsWith('--') && /^-o/.test(word) && !SHORT_O_NOT_FILE.has(part.name ?? '');
    if (!long && !short) return;
    const value = word.includes('=') && long ? word.slice(word.indexOf('=') + 1) : short && word.length > 2 ? word.slice(2) : args[i + 1];
    if (value === undefined) return;
    // round 10, CR LOW-1: node's reporter writes to stdout or stderr by those names
    if (name === '--test-reporter-destination' && (value === 'stdout' || value === 'stderr')) return;
    if (named && /format/.test(name)) {
      // `--output-format=json:out.json`: the path is after the colon
      if (value.includes(':')) values.push({ value: value.slice(value.indexOf(':') + 1), file: true });
    } else {
      values.push({ value, file: named });
    }
  });
  values.push(...toolOutputValues(part).map((value) => ({ value, file: true })));
  return values.flatMap(({ value, file }) => {
    if (value.includes(UNKNOWN) || value.length > MAX_WORD) return [UNKNOWN];
    const pieces = value.includes('=') ? value.split('=').slice(1) : [value];
    // an option named for its output names a file even without a `/` (`--report=out.json`)
    return pieces.filter((piece) => (file && piece !== '' && !piece.startsWith('-')) || pathLike(piece)).map((piece) => absolute(piece, part.cwd, home));
  });
}

/** Variables whose value names a folder or file a tool writes (`RUFF_CACHE_DIR`, `GOCACHE`, `PYLINTHOME`). */
/**
 * Round 8 (M3): `_LOG` is a level as often as a file, and `*_HOME`/`*_PATH` name what a tool reads
 * (JAVA_HOME): those are refused only as risky variables (CARGO_HOME …). Values must look like paths.
 */
const PATH_VARIABLE = /(?:_DIR|_CACHE|_ROOT|_TMP|_TEMP|_OUT|_FILE|^TMPDIR|^GOCACHE|^GOMODCACHE|^GOPATH|^PYLINTHOME|^NODE_V8_COVERAGE)$/;

/** The paths the part's path variables are set to, inline (`X_DIR=v cmd`, `env X_DIR=v`) or by export and its kind (round 6, sec L-B). */
function variablePaths(part: CommandPart, home: string): string[] {
  const pairs: Array<[string, string]> = part.assignments.map((name, i) => [name, part.assignmentValues[i] ?? UNKNOWN]);
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
    for (const word of part.words.slice(1)) {
      const at = word.indexOf('=');
      if (at > 0) pairs.push([word.slice(0, at), word.slice(at + 1)]);
    }
  }
  return pairs
    .filter(([name]) => PATH_VARIABLE.test(name))
    // node takes any NODE_V8_COVERAGE value as the folder it writes coverage to (round 11, SEC INFO-2)
    .flatMap(([name, value]) => (value.includes(UNKNOWN) ? [UNKNOWN] : value.split(':').filter((v) => v !== '' && (name === 'NODE_V8_COVERAGE' || pathLike(v))).map((v) => absolute(v, part.cwd, home))));
}

/** Where tar or unzip unpacks: the folder given (`-C`, `--directory`, `-d`), else the working folder. */
function extractTargets(part: CommandPart, home: string): string[] {
  const args = part.words.slice(1);
  if (part.name === 'unzip') {
    if (args.some((w) => /^-[A-Za-z]*[lvtcpzZ]/.test(w))) return [];
    return [optionValues(args, ['-d'])[0] ?? '.'].map((d) => absolute(d, part.cwd, home));
  }
  if (part.name !== 'tar' && part.name !== 'bsdtar' && part.name !== 'gtar') return [];
  const extracting = args.some((w, i) => !w.startsWith('--') && (w.startsWith('-') || i === 0) && /^-?[A-Za-z]*x/.test(w)) || args.some((w) => longOptionMatch(w, '--extract', 1) || longOptionMatch(w, '--get', 1));
  if (!extracting) return [];
  const dirs = [...optionValues(args, ['-C', '--directory', '--cd']), ...args.filter((w) => w.startsWith('--directory=')).map((w) => w.slice('--directory='.length))];
  return (dirs.length > 0 ? dirs : ['.']).map((d) => absolute(d, part.cwd, home));
}

/** tar long options that keep absolute or `..` names, or rename what it unpacks. */
const TAR_KEEPS_NAMES = ['--absolute-names', '--absolute-paths', '--insecure'];
const TAR_RENAMES = ['--transform', '--xform'];

/**
 * True for tar (or bsdtar) that can unpack outside its folder: `-P` (in a cluster or the old bundled
 * form), `--absolute-names`/`--absolute-paths`/`--insecure` (or a shortening), or, unpacking,
 * `-s`/`--transform`/`--xform`, which rename where each file lands.
 */
function tarEscapes(part: CommandPart): boolean {
  if (part.name !== 'tar' && part.name !== 'bsdtar' && part.name !== 'gtar') return false;
  const args = part.words.slice(1);
  const short = (letter: string): boolean => args.some((w, i) => !w.startsWith('--') && (w.startsWith('-') || i === 0) && new RegExp(`^-?[A-Za-z]*${letter}`).test(w));
  if (args.some((w) => TAR_KEEPS_NAMES.some((o) => longOptionMatch(w, o))) || short('P')) return true;
  const extracting = short('x') || args.some((w) => longOptionMatch(w, '--extract') || longOptionMatch(w, '--get'));
  return extracting && (short('s') || args.some((w) => TAR_RENAMES.some((o) => longOptionMatch(w, o))));
}

/** Programs whose output under xargs depends on how many words each run gets (`uniq IN OUT` writes OUT). */
const BY_WORD_COUNT = new Set(['uniq', 'xxd']);

/** Programs that run the repo's own code or config: a test run, a build, a package script, a linter that loads plugins. */
const REPO_CODE_PROGRAMS = new Set(['make', 'cargo', 'go', 'npm', 'pnpm', 'yarn', 'bun', 'mvn', 'mvnw', 'gradle', 'gradlew']);
/** More of them (round 6, sec L-A, CR L2/L5), matched by pattern. */
const REPO_CODE_NAMES = /^(?:tox|dotnet|flutter|dart|deno|mix|composer|rails|turbo|eslint|prettier|pylint|rubocop|playwright|xcodebuild)$/;
/** Options that name a folder, file, config or plugin a test run or build uses. */
const REPO_PATH_OPTIONS = [
  '-f', '--file', '-c', '--config', '-C', '-p', '-b', '--manifest-path', '--prefix', '--rootdir', '-s', '--dir', '--cwd', '--directory',
  '--load-plugins', '-r', '--require', '--plugin',
];

function runsRepoCode(part: CommandPart, settings: GateSettings): boolean {
  const name = part.name ?? '';
  return (
    REPO_CODE_PROGRAMS.has(name) ||
    REPO_CODE_NAMES.test(name) ||
    (settings.reviewNpxPackages ?? []).includes(name) ||
    settings.testCommandPatterns.some((p) => matchCommand(p, part.words))
  );
}

/** At most this many `=` in one word are read; more is refused (round 6, perf C1). */
const MAX_EQUALS = 8;

/**
 * The words of a part that may name a path: operands, `=values` (`-o cache_dir=x` too), and attached
 * short values. TOO_LONG when a word is over MAX_WORD characters or holds more than MAX_EQUALS `=`.
 */
function pathCandidates(part: CommandPart, shortOptions: readonly string[]): string[] {
  const out: string[] = [];
  for (const word of part.words.slice(1)) {
    tick();
    if (word.length > MAX_WORD) return [TOO_LONG];
    const values: string[] = [];
    for (let at = word.indexOf('='); at !== -1; at = word.indexOf('=', at + 1)) {
      if (values.length === MAX_EQUALS) return [TOO_LONG];
      values.push(word.slice(at + 1));
    }
    if (!word.startsWith('-')) out.push(word, ...values);
    else if (values.length > 0) out.push(...values);
    else {
      const attached = shortOptions.find((o) => o.length === 2 && word.startsWith(o) && word.length > 2);
      if (attached !== undefined) out.push(word.slice(2));
    }
  }
  return out;
}

/** Options that run code given on the command line: make's `--eval`, npm's `--node-options` (round 6, sec L-A). */
function runsGivenCode(part: CommandPart): boolean {
  const args = part.words.slice(1);
  if (part.name === 'make') return args.some((w) => longOptionMatch(w, '--eval') || /^-[A-Za-z]*E/.test(w));
  if (part.name === 'npm' || part.name === 'pnpm' || part.name === 'yarn') return args.some((w) => longOptionMatch(w, '--node-options'));
  return false;
}

/** True when the part runs in a reviewed repo and every path it names is inside one (round 5, sec H4). */
function staysInRepo(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  if (part.cwd.includes(UNKNOWN) || !insideRepo(part.cwd, scope.repos, paths, caseInsensitive)) return false;
  if (runsGivenCode(part)) return false;
  const args = part.words.slice(1);
  // xcodebuild's other values are output folders (checked as writes) and names
  const outputs = new Set(toolOutputValues(part));
  const named = part.name === 'xcodebuild' ? optionValues(args, ['-project', '-workspace']) : [...pathCandidates(part, REPO_PATH_OPTIONS), ...optionValues(args, REPO_PATH_OPTIONS)];
  // a tool's own output option is checked as an output (temp only), not as a repo path
  const words = named.filter((w) => !outputs.has(w));
  return words.every((w) => w !== TOO_LONG && !w.includes(UNKNOWN) && insideRepo(absolute(w, part.cwd, scope.home), scope.repos, paths, caseInsensitive));
}

/** Programs that only read what they are pointed at. */
const PURE_READERS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'ls', 'tree', 'find', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp',
  'comm', 'stat', 'file', 'du', 'df', 'basename', 'dirname', 'realpath', 'readlink', 'pwd', 'which', 'type', 'echo', 'printf', 'true', 'false',
  'test', '[', 'jq', 'yq', 'xxd', 'od', 'hexdump', 'shasum', 'sha256sum', 'md5', 'md5sum', 'column', 'nl', 'fold', 'expand', 'sed', 'sleep',
  'cd', 'pushd', 'popd', 'printenv', 'git', 'gh',
]);

/** True when a program other than a pure reader is given a path in the user's own files (`--cache-dir=~/.oss/x`, round 5, sec M1). */
/** Most path candidates read for one part (round 8, perf LOW 1): past it the part is too complex. */
const MAX_CANDIDATES = 4096;

function namesUserFiles(part: CommandPart, scope: ReviewScope, paths: PathResolver, caseInsensitive: boolean): boolean {
  if (part.name === null || PURE_READERS.has(part.name)) return false;
  const roots = rootsOf(userLevel(scope), paths);
  const candidates = [...new Set(pathCandidates(part, ['-o', '-C', '-c', '-f', '-p']))];
  if (candidates.length > MAX_CANDIDATES) return true;
  return candidates.some((word) => {
    tick();
    if (word === TOO_LONG) return true;
    if (word.includes(UNKNOWN)) return false;
    const p = absolute(word, part.cwd, scope.home);
    return [path.normalize(p), paths.realpath(p)].some((form) => roots.some((r) => isSameOrAncestor(r, form, caseInsensitive)));
  });
}
