/**
 * Push-setup rule (US-001 hardening): the protected-branch rule reads the branch and the push's
 * words before the command runs, so it refuses a `git push` it can't trust that reading for:
 * - one that runs after the same command line switched the branch, the repository or the
 *   upstream (`git checkout`, `git switch`, `git branch -m/-u` …), or set `GIT_DIR` and the like;
 * - one that carries its own config or repository (`git -c`, `--config-env`, `--git-dir`,
 *   `--work-tree`, or a `GIT_DIR` / `GIT_WORK_TREE` / `GIT_CONFIG*` variable, also via `env`).
 * It also refuses a `git config` that sets a key deciding where pushes go, so the change can't be
 * made in one call and used by a plain `git push` in the next. Reading such a key stays allowed.
 */

import { runsItsArguments, SAFE_GIT_VARIABLE, type CommandPart } from '../command-reader.js';
import { matchCommand } from '../patterns.js';
import { longOption, scriptFactsOf } from '../sed-awk.js';
import { UNKNOWN } from '../tokenize.js';
import { rawDestination } from './protected-branch.js';
import { readPushWords } from './push-words.js';
import type { Refusal } from './refusal.js';

/**
 * git subcommands after which the branch read before the command no longer holds (git syntax,
 * not rule values): they switch the branch or the repository a later `git push` runs in.
 */
const BRANCH_SWITCHES = new Set(['checkout', 'switch', 'symbolic-ref', 'worktree', 'init', 'clone']);
/** `git branch` options that rename the current branch or set its upstream (`-m`, `-u`, `--track` …). */
const BRANCH_SETUP_SHORT = /^-[A-Za-z]*[mMut]/;
const BRANCH_SETUP_LONG = ['--move', '--set-upstream-to', '--track'];
/** `git remote` subcommands that change where a remote points. */
const REMOTE_WRITES = new Set(['add', 'rename', 'remove', 'rm', 'set-url']);

/**
 * git config keys (git syntax, matched lowercased since git ignores case in section and key names;
 * `*` is any text) that decide what or where a plain `git push` sends, pull in other config, or make
 * git run a command (which could push or write anything). `credential.*` is left out: it only
 * supplies a password, except a credential helper that runs a program (checked by value, K11).
 */
const PUSH_KEYS = [
  // where and what a push sends
  'push.*', 'remote.pushdefault', 'remote.*.push', 'remote.*.url', 'remote.*.pushurl', 'remote.*.mirror',
  'remote.*.fetch', 'remote.*.receivepack', 'remote.*.uploadpack', 'remote.*.vcs',
  'branch.*.merge', 'branch.*.remote', 'branch.*.pushremote', 'url.*.insteadof', 'url.*.pushinsteadof',
  // other config files, and the repository's work tree
  'include.path', 'includeif.*.path', 'core.worktree',
  // commands git runs
  'alias.*', 'core.hookspath', 'core.sshcommand', 'core.gitproxy', 'core.askpass', 'core.fsmonitor', 'core.editor',
  'core.pager', 'pager.*', 'sequence.editor', 'diff.external', 'diff.*.command', 'diff.*.textconv', 'filter.*',
  'merge.*.driver', 'gpg.program', 'gpg.*.program', 'uploadpack.packobjectshook', 'difftool.*.cmd', 'mergetool.*.cmd',
  'web.browser', 'browser.*.cmd', 'browser.*.path', 'man.*.cmd', 'man.*.path',
];
/** Sections whose renaming or removal moves those keys. */
const PUSH_SECTIONS = new Set(PUSH_KEYS.map((key) => key.split('.')[0]));

/**
 * One `git config` option (git syntax, git 2.54 `git config [<verb>] -h`): its long name, its
 * letter, whether it takes a value, whether `--no-<name>` exists, and the action it picks in the
 * form without a verb (it reads, writes the key that follows, or renames or removes a section).
 */
interface ConfigOption {
  name: string;
  letter?: string;
  value?: boolean;
  negatable?: boolean;
  action?: 'read' | 'write' | 'section';
}
const CONFIG_FILE_OPTIONS: ConfigOption[] = [
  { name: 'global', negatable: true }, { name: 'system', negatable: true }, { name: 'local', negatable: true },
  { name: 'worktree', negatable: true }, { name: 'file', letter: 'f', value: true, negatable: true }, { name: 'blob', value: true, negatable: true },
];
const CONFIG_DISPLAY_OPTIONS: ConfigOption[] = [
  { name: 'null', letter: 'z', negatable: true }, { name: 'name-only', negatable: true }, { name: 'show-origin', negatable: true },
  { name: 'show-scope', negatable: true }, { name: 'show-names', negatable: true },
];
const CONFIG_TYPE_OPTIONS: ConfigOption[] = [
  { name: 'type', letter: 't', value: true, negatable: true }, { name: 'bool' }, { name: 'int' }, { name: 'bool-or-int' },
  { name: 'bool-or-str' }, { name: 'path' }, { name: 'expiry-date' },
];
const CONFIG_LEGACY_ACTIONS: ConfigOption[] = [
  ...['get', 'get-all', 'get-regexp', 'get-urlmatch', 'get-color', 'get-colorbool'].map((name): ConfigOption => ({ name, action: 'read' })),
  { name: 'list', letter: 'l', action: 'read' },
  ...['add', 'replace-all', 'unset', 'unset-all'].map((name): ConfigOption => ({ name, action: 'write' })),
  { name: 'edit', letter: 'e', action: 'write' },
  { name: 'rename-section', action: 'section' }, { name: 'remove-section', action: 'section' },
];
const negatableFlag = (name: string): ConfigOption => ({ name, negatable: true });
const negatableValue = (name: string): ConfigOption => ({ name, value: true, negatable: true });
/**
 * The options of each `git config` form (git syntax): the form without a verb (null), and the
 * subcommand forms of git 2.46+ (`git config set …`), whose verb is only ever the first word.
 * git reads an option by its full name or any unambiguous prefix (parse-options), so each form's
 * own list decides what a prefix means (`--val` is `--value` after `set`, unknown without a verb).
 */
const CONFIG_FORMS = new Map<string | null, ConfigOption[]>([
  [null, [
    ...CONFIG_FILE_OPTIONS, ...CONFIG_LEGACY_ACTIONS, ...CONFIG_DISPLAY_OPTIONS, ...CONFIG_TYPE_OPTIONS,
    negatableValue('default'), negatableValue('comment'), negatableFlag('fixed-value'), negatableFlag('includes'),
  ]],
  ['get', [
    ...CONFIG_FILE_OPTIONS, ...CONFIG_DISPLAY_OPTIONS, ...CONFIG_TYPE_OPTIONS, negatableFlag('includes'), negatableFlag('all'),
    negatableFlag('regexp'), negatableValue('value'), negatableFlag('fixed-value'), negatableValue('url'), negatableValue('default'),
  ]],
  ['set', [
    ...CONFIG_FILE_OPTIONS, ...CONFIG_TYPE_OPTIONS, negatableFlag('all'), negatableValue('value'), negatableFlag('fixed-value'),
    negatableValue('comment'), negatableFlag('append'),
  ]],
  ['unset', [...CONFIG_FILE_OPTIONS, negatableFlag('all'), negatableValue('value'), negatableFlag('fixed-value')]],
  ['list', [...CONFIG_FILE_OPTIONS, ...CONFIG_DISPLAY_OPTIONS, ...CONFIG_TYPE_OPTIONS, negatableFlag('includes')]],
  ['rename-section', CONFIG_FILE_OPTIONS],
  ['remove-section', CONFIG_FILE_OPTIONS],
  ['edit', CONFIG_FILE_OPTIONS],
]);
const CONFIG_READ_VERBS = new Set(['get', 'list']);
const CONFIG_SECTION_VERBS = new Set(['rename-section', 'remove-section']);

/** git global options that point a push at other config or another repository. */
const PUSH_GLOBAL_OPTIONS = ['-c', '--config-env', '--git-dir', '--work-tree'];
/** Variables that point git at another repository or extra config (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` …). */
const GIT_REPO_VARIABLE = /^GIT_(?:DIR|WORK_TREE|CONFIG.*)$/;
/**
 * Variables that change the config, repository or programs git uses: any `GIT_*` (`GIT_SSH_COMMAND`,
 * `GIT_DIR` …), and `HOME` / `XDG_CONFIG_HOME`, where git finds the user's config.
 */
const GIT_SETUP_VARIABLE = /^(?:GIT_[A-Za-z0-9_]*|HOME|XDG_CONFIG_HOME)$/;
/**
 * A variable that changes git's setup, and is not one that only labels a commit or traces git
 * (`SAFE_GIT_VARIABLE`): those don't change the repository, the config or the programs git runs. A
 * trace written to a file names that file, which the path rules check.
 */
function setupVariable(name: string): boolean {
  return GIT_SETUP_VARIABLE.test(name) && !SAFE_GIT_VARIABLE.test(name);
}

/** The options a new-branch `git checkout -b` / `git switch -c` may carry (git syntax): they only quieten it. */
const QUIET = new Set(['-q', '--quiet']);
/** The option that creates the branch, per subcommand. */
const CREATE_OPTIONS = new Map<string, readonly string[]>([
  ['checkout', ['-b']],
  ['switch', ['-c', '--create']],
]);

/**
 * The branch a plain `git checkout -b <name> [<start>]` or `git switch -c <name> [<start>]` creates
 * and moves to, with its start point, or null for any other form (`-B`, `-t`, an unknown name …),
 * which still counts as a branch switch.
 */
function createdBranchStart(part: CommandPart): { name: string; start: string | undefined } | null {
  const git = part.git;
  if (git === null) return null;
  const create = CREATE_OPTIONS.get(git.subcommand);
  const args = git.args.filter((a) => !QUIET.has(a));
  if (create === undefined || !create.includes(args[0]) || args.length < 2 || args.length > 3) return null;
  const [, name, start] = args;
  if (name.startsWith('-') || name.includes(UNKNOWN) || start?.startsWith('-') === true) return null;
  return { name, start };
}

function createdBranch(part: CommandPart): string | null {
  return createdBranchStart(part)?.name ?? null;
}

/**
 * A start point that is surely not a remote-tracking branch (`HEAD~1`, a commit, a local branch): a branch made
 * from a remote one gets it as its upstream, which a bare `git push` may then push to (git
 * `branch.autoSetupMerge`, `push.default=upstream`). A name with `/` may be `origin/main`.
 */
function localStart(start: string): boolean {
  return !start.includes('/') && !start.includes(UNKNOWN);
}

/** True when the push names `branch` as a destination (`origin feat/y`, `origin HEAD:feat/y`). */
function pushNames(part: CommandPart, branch: string): boolean {
  const { positional } = readPushWords(part.git?.args ?? []);
  return positional.slice(1).some((spec) => {
    const dst = rawDestination(spec);
    return dst === branch || dst === `refs/heads/${branch}`;
  });
}

/**
 * The branch the commit or push `part` runs on because an earlier part (of the first `count`)
 * created it in the same folder, joined to it by `&&` all the way (fix round 4, K2), or null. A
 * branch made from a start point that may be a remote branch counts for a push only when the push
 * names it.
 */
function newBranchFor(parts: readonly CommandPart[], count: number, part: CommandPart | undefined): string | null {
  const dir = part?.git?.dir;
  let created: { name: string; start: string | undefined } | null = null;
  for (let i = 0; i < count; i++) {
    const made = parts[i].git?.dir === dir ? createdBranchStart(parts[i]) : null;
    if (made !== null) created = made;
    else if (setupChange(parts[i]) !== null) created = null;
    if (!parts[i].followedByAnd) created = null;
  }
  if (created === null || part === undefined) return null;
  const { name, start } = created;
  if (part.git?.subcommand === 'push' && start !== undefined && !localStart(start) && !pushNames(part, name)) return null;
  return name;
}

/**
 * The branch a commit or push at `index` runs on because an earlier part of the same command
 * created it (`git checkout -b feat/x && git push -u origin feat/x`), or null when none did, a
 * later switch moved away from it, or something other than `&&` comes between them.
 */
export function branchCreatedBefore(parts: readonly CommandPart[], index: number): string | null {
  return newBranchFor(parts, index, parts[index]);
}

/** Shell builtins that export or set the variables named in their words. */
const VARIABLE_SETTERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);

/** The `git config` option a long word (`--ty`, `--no-g`, `--file=x` without `--`/`=x`) names in this form: exact, else the one it is a prefix of; null when none or several. */
function configLong(options: readonly ConfigOption[], flag: string): { option: ConfigOption; negated: boolean } | null {
  const names = options.flatMap((option) => [
    { name: option.name, option, negated: false },
    ...(option.negatable === true ? [{ name: `no-${option.name}`, option, negated: true }] : []),
  ]);
  const exact = names.find((n) => n.name === flag);
  if (exact !== undefined) return exact;
  const prefixed = names.filter((n) => n.name.startsWith(flag));
  return flag !== '' && prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * A `git config` call's words read as git's parse-options reads them (fix part K12): letters in a
 * cluster (`-zt bool`, `-tbool`), long options by any unambiguous prefix (`--ty`, `set --val`), each
 * value option taking the rest of its word or the next one. Options end at the key (later words are
 * values, `-1` included) or at `--`. An option this form doesn't have, or a prefix of several, is
 * an error in git; the gate can't tell which word is the key then, so the call is unreadable.
 */
function readConfigWords(args: readonly string[]): { verb: string | null; actions: Set<string>; positional: string[] } | { unreadable: string } {
  const verb = args[0] !== undefined && CONFIG_FORMS.has(args[0]) ? args[0] : null;
  const options = CONFIG_FORMS.get(verb) ?? [];
  const actions = new Set<string>();
  const positional: string[] = [];
  for (let i = verb === null ? 0 : 1; i < args.length; i++) {
    const a = args[i];
    if (positional.length > 0 || a === '-' || !a.startsWith('-')) {
      positional.push(a);
    } else if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const long = configLong(options, a.slice(2, eq === -1 ? undefined : eq));
      if (long === null) return { unreadable: a };
      const takesValue = long.option.value === true && !long.negated;
      if (takesValue && eq === -1 && ++i >= args.length) return { unreadable: a };
      if (!takesValue && eq !== -1) return { unreadable: a };
      if (long.option.action !== undefined && !long.negated) actions.add(long.option.action);
    } else {
      for (let j = 1; j < a.length; j++) {
        const option = options.find((o) => o.letter === a[j]);
        if (option === undefined) return { unreadable: a };
        if (option.action !== undefined) actions.add(option.action);
        if (option.value !== true) continue;
        if (j + 1 === a.length && ++i >= args.length) return { unreadable: a };
        break;
      }
    }
  }
  return { verb, actions, positional };
}

/**
 * What a `git config` call does to a push key: the key it writes, or null when it only reads or
 * writes others; `unreadable` (the option word) when its options can't be read as git reads them.
 * A credential helper (`credential[.<url>].helper`) counts when its value runs a program the agent
 * may have written (helperRuns), in any write form: plain, `--add`, `--replace-all`, `set`, with
 * `--global` / `--system` / `--local` / `--worktree` / `--file`.
 */
function pushKeyWritten(args: string[]): string | { unreadable: string } | null {
  const words = readConfigWords(args);
  if ('unreadable' in words) return words;
  const { verb, actions, positional } = words;
  if (verb !== null && CONFIG_READ_VERBS.has(verb)) return null;
  const read = actions.has('read');
  const section = actions.has('section') || (verb !== null && CONFIG_SECTION_VERBS.has(verb));
  const write = actions.has('write') || verb !== null;
  const key = positional[0];
  if (key === undefined || read || !(write || section || positional.length >= 2)) return null;
  const lower = key.toLowerCase();
  if (section) return PUSH_SECTIONS.has(lower.split('.')[0]) ? key : null;
  // a credential helper git runs: the same value checks as `git -c` (K5, K8, K9, K10), in every write form (K11)
  if (keyMatches(CREDENTIAL_KEYS, lower)) return positional[1] !== undefined && helperRuns(positional[1]) ? key : null;
  return PUSH_KEYS.some((pattern) => matchCommand(pattern, [lower])) ? key : null;
}

/**
 * The variable an earlier part set for the rest of the shell (`HOME=x;` alone, `export GIT_DIR=x`)
 * that changes git's setup, or null. A `GIT_DIR` / `GIT_WORK_TREE` / `GIT_CONFIG*` set for any
 * earlier command counts too, as before.
 */
function variableChange(part: CommandPart): string | null {
  const assigned = part.assignments.find((name) => GIT_REPO_VARIABLE.test(name) || (part.program === null && setupVariable(name)));
  if (assigned !== undefined) return part.assignments.join(' ');
  // `export` and the like are builtins: the shell finds them by exact name
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
    const named = part.words.slice(1).find((w) => setupVariable(w.split('=')[0]));
    if (named !== undefined) return `${part.program} ${named.split('=')[0]}`;
  }
  return null;
}

/** The git subcommand (with its option) by which an earlier part moved the branch or the push setup, or null. */
function setupChange(part: CommandPart): string | null {
  const variable = variableChange(part);
  if (variable !== null) return variable;
  const git = part.git;
  if (git === null) return null;
  const sub = git.subcommand;
  if (BRANCH_SWITCHES.has(sub)) return `git ${sub}`;
  if (sub === 'remote' && REMOTE_WRITES.has(git.args[0] ?? '')) return `git remote ${git.args[0]}`;
  const option = git.args.find((a) => (!a.startsWith('--') && BRANCH_SETUP_SHORT.test(a)) || BRANCH_SETUP_LONG.some((o) => a === o || a.startsWith(`${o}=`)));
  if (sub === 'branch' && option !== undefined) return `git branch ${option}`;
  return null;
}

/** The git global option or variable this push carries that changes its config or repository, or null. */
function carriedSetup(part: CommandPart): string | null {
  const git = part.git;
  if (git === null) return null;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    if (!PUSH_GLOBAL_OPTIONS.some((o) => w === o || w.startsWith(`${o}=`))) continue;
    // fix round 4, K7 (user choice): an ssh command that passes the ssh check may come with the push
    if (w === '-c' && checkedSshSetting(globals[i + 1])) {
      i++;
      continue;
    }
    return `git ${w.split('=')[0]}`;
  }
  return part.assignments.find((name, n) => setupVariable(name) && !(SSH_VARIABLES.has(name) && harmlessSsh(part.assignmentValues[n] ?? ''))) ?? null;
}

/** True for a `core.sshCommand=<value>` setting whose value passes the ssh check. */
function checkedSshSetting(setting: string | undefined): boolean {
  if (setting === undefined || !setting.includes('=')) return false;
  return keyMatches(SSH_KEYS, keyOf(setting)) && harmlessSsh(setting.slice(setting.indexOf('=') + 1));
}

function cantCheck(why: string, subcommand = 'push'): Refusal {
  const advice = subcommand === 'push' ? 'Push with a separate plain `git push`.' : `Run a separate plain \`git ${subcommand}\`.`;
  return {
    rule: 'protected-branch',
    reason: `Refused: this \`git ${subcommand}\` can't be checked: ${why}. ${advice}`,
  };
}

/** `git remote add --mirror`: every later push to that remote sends all refs, protected branches too. */
function addsMirror(git: NonNullable<CommandPart['git']>): boolean {
  return git.subcommand === 'remote' && git.args[0] === 'add' && git.args.some((a) => a === '--mirror' || a.startsWith('--mirror='));
}

/** The reason a push or commit runs in a folder the gate can't follow, or null. */
function lostFolder(part: CommandPart): string | null {
  if (part.lostDir === null) return null;
  return `\`${part.lostDir.why}\` moves it to a folder the gate can't follow`;
}

/** git's trace variables (git syntax): their value is a number, `true`, or the absolute path of a file git writes. */
const TRACE_VARIABLE = /^GIT_TRACE[A-Za-z0-9_]*$/;

/**
 * A trace variable this part sets (for itself, or for the rest of the shell) to a value only known
 * when it runs: git would write its trace to a file the gate can't check (fix round 4, K2).
 */
function unknownTrace(part: CommandPart, own: boolean): string | null {
  const assigned = part.assignments.find((name, n) => TRACE_VARIABLE.test(name) && part.assignmentValues[n]?.includes(UNKNOWN) === true);
  if (assigned !== undefined && (own || part.program === null)) return assigned;
  if (part.program === null || !VARIABLE_SETTERS.has(part.program)) return null;
  const word = part.words.slice(1).find((w) => TRACE_VARIABLE.test(w.split('=')[0]) && w.includes(UNKNOWN));
  return word === undefined ? null : word.split('=')[0];
}

/** The trace variable set to an unknown value for this commit or push, by it or an earlier part, or null. */
function traceSet(part: CommandPart, earlier: readonly CommandPart[], count: number): string | null {
  let found = unknownTrace(part, true);
  for (let i = 0; i < count && found === null; i++) found = unknownTrace(earlier[i], false);
  return found;
}

/** A commit is refused when it, or an earlier part, changes which repository or config git uses. */
function checkCommitSetup(part: CommandPart, earlier: readonly CommandPart[], count: number): Refusal | null {
  const lost = lostFolder(part);
  if (lost !== null) return cantCheck(lost, 'commit');
  const trace = traceSet(part, earlier, count);
  if (trace !== null) return cantCheck(`\`${trace}\` sends git's trace to a file only known when it runs`, 'commit');
  const carried = part.assignments.find(setupVariable);
  if (carried !== undefined) return cantCheck(`\`${carried}\` changes which repository or settings it uses`, 'commit');
  for (let i = 0; i < count; i++) {
    const change = variableChange(earlier[i]);
    if (change !== null) return cantCheck(`\`${change}\` earlier in the same command changes which repository or settings it uses`, 'commit');
  }
  return null;
}

/**
 * `earlier` holds the parts before this one in its first `count` entries (all of them by default):
 * the gate passes the whole call and the part's index, so no list is copied per part.
 */
export function checkPushSetup(part: CommandPart, earlier: readonly CommandPart[], count = earlier.length): Refusal | null {
  const planted = plantedConfig(part, earlier, count);
  if (planted !== null) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`git ${part.git?.subcommand}\` with \`${planted}\` plants config or hooks in the new repository, which can change where pushes go or what git runs. Ask the user to run it with \`!\`.`,
    };
  }
  const tty = fakeTtyPager(part, earlier, count);
  if (tty !== null) return runsRefusal(tty, `\`git ${part.git?.subcommand}\` (it has a terminal, so git starts its pager)`);
  const runs = runConfig(part, earlier, count) ?? uploadProgram(part);
  if (runs !== null) return runsRefusal(runs, `\`git ${part.git?.subcommand}\``);
  if (part.git?.subcommand === 'config') {
    const key = pushKeyWritten(part.git.args);
    if (key === null) return null;
    if (typeof key !== 'string') {
      return {
        rule: 'protected-branch',
        reason: `Refused: the gate can't read \`git config\` option \`${key.unreadable}\` (one git doesn't have, or short for several), so it can't tell which key is written. Spell the options in full.`,
      };
    }
    return {
      rule: 'protected-branch',
      reason: `Refused: \`git config ${key}\` changes where pushes go or what git runs. Ask the user to change it with \`!\`.`,
    };
  }
  if (part.git !== null && addsMirror(part.git)) {
    return {
      rule: 'protected-branch',
      reason: 'Refused: `git remote add --mirror` changes where pushes go (every push to it sends all branches). Ask the user to add it with `!`.',
    };
  }
  if (part.git?.subcommand === 'commit') return checkCommitSetup(part, earlier, count) ?? programVariableRefusal(part, earlier, count);
  if (part.git?.subcommand !== 'push') return null;
  const lost = lostFolder(part);
  if (lost !== null) return cantCheck(lost);
  const carried = carriedSetup(part);
  if (carried !== null) return cantCheck(`\`${carried}\` changes which repository or settings it uses`);
  const trace = traceSet(part, earlier, count);
  if (trace !== null) return cantCheck(`\`${trace}\` sends git's trace to a file only known when it runs`);
  for (let i = 0; i < count; i++) {
    // a new branch created in the same folder is the branch the push runs on (the gate checks that one)
    if (earlier[i].git?.dir === part.git.dir && createdBranch(earlier[i]) !== null && newBranchFor(earlier, count, part) !== null) continue;
    const change = setupChange(earlier[i]);
    if (change !== null) return cantCheck(`\`${change}\` earlier in the same command changes which branch it pushes or where`);
  }
  const program = uploadProgram(part);
  return program === null ? programVariableRefusal(part, earlier, count) : runsRefusal(program, '`git push`');
}

function runsRefusal(what: string, where: string): Refusal {
  return {
    rule: 'protected-branch',
    reason: `Refused: \`${what}\` makes ${where} run a hook folder or program the agent may have written. Ask the user to run it with \`!\`.`,
  };
}

/** A commit or push refuses its own config and `GIT_*` setup; this adds the program variables outside `GIT_*` (fix round 4, K5). */
function programVariableRefusal(part: CommandPart, earlier: readonly CommandPart[], count: number): Refusal | null {
  const name = programVariable(callSettings(part, earlier, count));
  return name === undefined ? null : runsRefusal(name, `\`git ${part.git?.subcommand}\``);
}

/** git subcommands that make a new repository, whose config and hooks they can be told to plant (git syntax). */
const NEW_REPO_SUBCOMMANDS = new Set(['clone', 'init']);
/** The config key that copies a template folder (its config and hooks) into a new repository (git syntax, lowercased). */
const TEMPLATE_KEY = 'init.templatedir';
/** Variables that give a new repository a template or extra config (git syntax). */
const NEW_REPO_VARIABLE = /^GIT_(?:TEMPLATE_DIR|CONFIG.*)$/;

/** A template or config variable an earlier part set for the rest of the shell (`export GIT_TEMPLATE_DIR=t;`), or undefined. */
function variableSetBefore(earlier: readonly CommandPart[], count: number): string | undefined {
  for (let i = 0; i < count; i++) {
    const part = earlier[i];
    const assigned = part.program === null ? part.assignments.find((name) => NEW_REPO_VARIABLE.test(name)) : undefined;
    if (assigned !== undefined) return assigned;
    // `export` and the like are builtins: the shell finds them by exact name
    if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
      const named = part.words.slice(1).map((w) => w.split('=')[0]).find((name) => NEW_REPO_VARIABLE.test(name));
      if (named !== undefined) return named;
    }
  }
  return undefined;
}

/** True when a `key=value` sets a push key, or the template folder. */
function plantsKey(setting: string): boolean {
  const key = (setting.includes('=') ? setting.slice(0, setting.indexOf('=')) : setting).toLowerCase();
  return key === TEMPLATE_KEY || PUSH_KEYS.some((pattern) => matchCommand(pattern, [key]));
}

/** The key of a `key=value` setting, as written. */
function keyOf(setting: string): string {
  return setting.includes('=') ? setting.slice(0, setting.indexOf('=')) : setting;
}

/**
 * What makes a `git clone` / `git init` plant config or hooks in the repository it makes (fix round
 * 4, K3), or null: `--template` (any unambiguous prefix, as git reads long options), clone's own
 * `-c` / `--config` setting a push key or the template folder (it is written into the new config),
 * the same set with `git -c` (it applies while clone checks out, so a hook or fsmonitor runs),
 * `--config-env`, or a `GIT_TEMPLATE_DIR` / `GIT_CONFIG*` variable. A plain clone or init has none.
 */
function plantedConfig(part: CommandPart, earlier: readonly CommandPart[], count: number): string | null {
  const git = part.git;
  if (git === null || !NEW_REPO_SUBCOMMANDS.has(git.subcommand)) return null;
  const variable = part.assignments.find((name) => NEW_REPO_VARIABLE.test(name)) ?? variableSetBefore(earlier, count);
  if (variable !== undefined) return variable;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    if (w === '--config-env' || w.startsWith('--config-env=')) return '--config-env';
    if (w === '-c' && i + 1 < globals.length && plantsKey(globals[i + 1])) return keyOf(globals[i + 1]);
  }
  const { args } = git;
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const a = args[i];
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (a.startsWith('--') && longOption(a, '--template', 4)) return flag;
    if (git.subcommand !== 'clone') continue;
    let setting: string | undefined;
    if (a.startsWith('--') && longOption(a, '--config', 5)) setting = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
    else if (a === '-c') setting = args[++i];
    else if (a.startsWith('-c') && !a.startsWith('--')) setting = a.slice(2);
    if (setting !== undefined && plantsKey(setting)) return keyOf(setting);
  }
  return null;
}

/**
 * Config keys (git syntax, lowercased, `*` is any text) that make ordinary git subcommands run a
 * hook folder, a program, or config the agent may have written, whatever their value (fix round 4,
 * K4). `alias.*` hides the real subcommand from every rule; `include.path` pulls in any key;
 * `protocol.allow` / `protocol.ext.allow` let an `ext::` URL run a command.
 */
const RUN_ANY_KEYS = ['core.hookspath', 'alias.*', 'include.path', 'includeif.*.path', 'protocol.allow', 'protocol.ext.allow'];
/**
 * Config keys whose value is a command git runs (git syntax, lowercased). The pager keys are left
 * out: git starts a pager only when its output is a terminal, which the agent's never is.
 */
const RUN_COMMAND_KEYS = [
  'core.fsmonitor', 'core.editor', 'sequence.editor', 'diff.external', 'diff.*.textconv',
  'diff.*.command', 'filter.*.clean', 'filter.*.smudge', 'filter.*.process', 'gpg.program', 'gpg.*.program',
  'uploadpack.packobjectshook', 'core.alternaterefscommand', 'core.askpass', 'core.gitproxy', 'merge.*.driver',
];
/**
 * Values of a command key that run nothing the agent wrote (shell and git syntax): the shell's
 * `true` / `false` / `:` builtins (`-c core.editor=true`), or an off / built-in `core.fsmonitor`.
 */
const NO_PROGRAM_VALUES = new Set(['', 'true', 'false', ':']);
/** Variables that hand git config keys for any subcommand (git syntax). */
const CONFIG_KEY_VARIABLE = /^GIT_CONFIG_KEY_[0-9]+$/;

function keyMatches(patterns: readonly string[], key: string): boolean {
  return patterns.some((pattern) => matchCommand(pattern, [key.toLowerCase()]));
}

/**
 * True when `key` set to `value` (undefined: in a variable the gate can't see) can make git run what
 * the agent wrote. A key only known when git runs may be any of them: an unreadable call is refused
 * only when risky (ADR-010), so it is refused here.
 */
function runsProgram(key: string, value: string | undefined): boolean {
  if (key.includes(UNKNOWN) || keyMatches(RUN_ANY_KEYS, key)) return true;
  if (keyMatches(CREDENTIAL_KEYS, key)) return value === undefined || helperRuns(value);
  if (keyMatches(SSH_KEYS, key)) return value === undefined || !harmlessSsh(value);
  const program = REMOTE_PROGRAM_KEYS.find(([pattern]) => keyMatches([pattern], key));
  if (program !== undefined) return value !== program[1];
  return keyMatches(RUN_COMMAND_KEYS, key) && (value === undefined || !NO_PROGRAM_VALUES.has(value));
}

/** Credential helper keys (git syntax, lowercased; `credential.<url>.helper`). */
const CREDENTIAL_KEYS = ['credential.helper', 'credential.*.helper'];
/** The program a remote runs to send or take a pack, with git's default (git syntax). */
const REMOTE_PROGRAM_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['remote.*.uploadpack', 'git-upload-pack'],
  ['remote.*.receivepack', 'git-receive-pack'],
];
/**
 * True when a credential helper value runs a program the agent may have written (fix round 4, K5,
 * git syntax). A value without `!` runs git's own `git-credential-<value>`, unless it names a file
 * (`./h`, `/tmp/h`) or holds shell syntax (`store;x`, run through a shell: K8). A `!` value is a
 * shell command, harmless only as simple words whose program is a plain name on PATH (or one in a
 * standard bin folder) that runs nothing it is given (K9): `!gh auth git-credential`.
 */
function helperRuns(value: string): boolean {
  if (value.includes(UNKNOWN)) return true;
  // git runs a value without `!` as `git credential-<value>` through a shell, so shell syntax in it runs too (K8)
  if (!value.startsWith('!')) return value.includes('/') || SHELL_METACHARACTER.test(value);
  const words = simpleWords(value.slice(1));
  return words === null || helperCommandRuns(words);
}

/** Characters that end a command or start a redirect, a substitution or a subshell (shell syntax). */
const SHELL_METACHARACTER = /[;&|$`<>()\n]/;
/**
 * The characters a `!` helper or an ssh command may hold (fix round 4, K9): letters, digits, blanks
 * between words, quotes, and `_@%+=:,./~-`. Anything else (`;`, `|`, `$`, a backquote, a backslash,
 * a glob, `{`, `#`, a newline …) is shell syntax the gate doesn't follow, so the value is refused.
 */
const SIMPLE_TEXT = /^[A-Za-z0-9_@%+=:,./~ \t'"-]*$/;
/** A program word the shell looks up on PATH: no `/`, no assignment, no reserved word (shell syntax). */
const PLAIN_PROGRAM = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
/**
 * Programs that run code or commands they are given, beyond the reader's own tables (K6, K10):
 * shells, builtins and interpreters, `find` (its `-exec`; refused whatever its words, which is
 * simpler), `watch`, `parallel`, `make`, and the editors that run commands (`vim -c`, `:!`).
 */
const CODE_RUNNERS = new Set([
  'fish', 'eval', 'source', 'csh', 'tcsh', 'pwsh', 'powershell', 'tclsh', 'wish', 'lua', 'luajit',
  'find', 'watch', 'parallel', 'make', 'vim', 'vi', 'nvim', 'ex',
]);
/** git options that make it run another program or config (git syntax): `-c`, `--config-env`, `--exec-path`. */
const GIT_RUN_OPTIONS = ['-c', '--config-env', '--exec-path'];
/** 1Password's `op` subcommands that run the command after `--` (op syntax). */
const OP_RUN_COMMANDS = [['run'], ['plugin', 'run']];

/**
 * The words of simple shell text (`SIMPLE_TEXT`) as the shell splits them, quotes removed, or null
 * for other text or a quote left open: `-o 'ConnectTimeout 10'` is two words, the second with a blank.
 */
function simpleWords(text: string): string[] | null {
  if (!SIMPLE_TEXT.test(text)) return null;
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ' || c === '\t') {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end === -1) return null;
      word = (word ?? '') + text.slice(i + 1, end);
      i = end;
    } else {
      word = (word ?? '') + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

/**
 * The folders an absolute helper program may sit in (file-system layout, not rule values): the
 * system's and the package managers' bin folders, and an installed app's bundle, which the agent
 * doesn't write. Anywhere else (`/tmp/x`) may be a file it wrote.
 */
const STANDARD_BIN_FOLDERS = new Set(['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/sbin', '/sbin', '/opt/local/bin']);
const APP_BUNDLE_PROGRAM = /^\/Applications\/[^/]+\/Contents\/.+/;

/**
 * True when a `!` helper's command (its words, quotes removed) may run code the agent wrote: its
 * program is not a plain PATH name or a standard bin folder's program, or is a shell, an interpreter,
 * awk or sed, or a wrapper that runs its arguments (`nohup`, `xargs`, `sudo` … from the reader's
 * tables, K9; `find`, `make`, `vim` … K10). A `git` carrying `-c`, `--config-env` or `--exec-path`
 * counts, and an `op run` / `op plugin run` whose command after `--` counts, or has no `--` (K10).
 * Names are compared lowercased: macOS finds `Env` as `env`.
 */
function helperCommandRuns(words: readonly string[]): boolean {
  const [program] = words;
  if (program === undefined) return true;
  if (!PLAIN_PROGRAM.test(program) && !standardProgram(program)) return true;
  const base = program.slice(program.lastIndexOf('/') + 1).toLowerCase();
  if (CODE_RUNNERS.has(base) || runsItsArguments(base) || scriptFactsOf(base, []) !== null) return true;
  if (base === 'git') return words.some((w) => GIT_RUN_OPTIONS.some((o) => w === o || w.startsWith(`${o}=`)));
  const runs = base === 'op' && OP_RUN_COMMANDS.some((sub) => sub.every((w, n) => words[n + 1] === w));
  if (!runs) return false;
  const end = words.indexOf('--');
  return end === -1 || helperCommandRuns(words.slice(end + 1));
}

/** An absolute program in a standard bin folder or an app bundle, with no `..`. */
function standardProgram(program: string): boolean {
  if (!program.startsWith('/') || program.split('/').includes('..')) return false;
  return STANDARD_BIN_FOLDERS.has(program.slice(0, program.lastIndexOf('/'))) || APP_BUNDLE_PROGRAM.test(program);
}

/** The ssh command keys and variables (git syntax): their value is the ssh git runs. */
const SSH_KEYS = ['core.sshcommand'];
const SSH_VARIABLES = new Set(['GIT_SSH_COMMAND', 'GIT_SSH']);
/** ssh itself, by name or by an absolute path (in a standard bin folder: K7). */
const SSH_PROGRAM = /^(?:ssh|\/(?:[^/\s]+\/)*ssh)$/;
/** ssh's short options that take no value (ssh syntax): alone, repeated or grouped (`-vvv`, `-4q`). */
const SSH_PLAIN_LETTERS = new Set([...'46AaCkNnqTtv']);
/** ssh's short options whose value loads and runs nothing: port, user, key file, cipher, MAC, bind address. */
const SSH_VALUE_LETTERS = new Set([...'plicmb']);
/** ssh's `-o` option (ssh syntax). */
const SSH_OPTION_LETTER = 'o';
/**
 * The ssh_config keys an `-o` may set (ssh_config syntax, matched lowercased as ssh does): none
 * loads a program, a library or other config (fix round 4, K9). `ControlPath` names a socket ssh
 * makes, like the agent's own `ssh -S`.
 */
const SSH_OPTION_KEYS = new Set([
  'StrictHostKeyChecking', 'UserKnownHostsFile', 'BatchMode', 'ConnectTimeout', 'IdentitiesOnly', 'IdentityFile', 'Port', 'User',
  'ServerAliveInterval', 'ServerAliveCountMax', 'LogLevel', 'Compression', 'HostKeyAlias', 'PreferredAuthentications',
  'PubkeyAuthentication', 'PasswordAuthentication', 'AddKeysToAgent', 'ControlMaster', 'ControlPath', 'ControlPersist',
  // K10: algorithm lists, retries and agent forwarding (ForwardAgent may name an agent socket, not a program)
  'ForwardAgent', 'ConnectionAttempts', 'HostKeyAlgorithms', 'PubkeyAcceptedKeyTypes', 'PubkeyAcceptedAlgorithms',
  'KexAlgorithms', 'Ciphers', 'MACs',
].map((key) => key.toLowerCase()));
/** An `-o` value's key, before its `=` or blank (`Key=Value`, `Key Value`). */
const SSH_OPTION_KEY = /^([A-Za-z]+)[ \t=]/;

/**
 * True when an ssh value runs only ssh with options on an allowlist (fix round 4, K6, K9): its program
 * word is `ssh` or a standard bin folder's `ssh` (K7), it is simple words (no shell syntax, no
 * backslash), and every word after it is an allowed option or its value: `-p`, `-l`, `-i`, `-c`,
 * `-m`, `-b`, the plain flags, and `-o` with an allowed key. Anything else (`-F`, `-I`, `-J`, `-E`,
 * forwarding, a host or command after the options …) is refused.
 */
function harmlessSsh(value: string): boolean {
  if (NO_PROGRAM_VALUES.has(value)) return true;
  const words = simpleWords(value);
  if (words === null || words.length === 0) return false;
  const [program, ...options] = words;
  if (!SSH_PROGRAM.test(program) || (program !== 'ssh' && !standardProgram(program))) return false;
  for (let i = 0; i < options.length; i++) {
    const w = options[i];
    if (!w.startsWith('-') || w.length < 2) return false;
    // in a group (`-vp 22`), the first letter that takes a value takes the rest, or the next word
    for (let at = 1; at < w.length; at++) {
      const letter = w[at];
      if (SSH_PLAIN_LETTERS.has(letter)) continue;
      if (letter !== SSH_OPTION_LETTER && !SSH_VALUE_LETTERS.has(letter)) return false;
      const optionValue = at + 1 < w.length ? w.slice(at + 1) : options[++i];
      if (optionValue === undefined) return false;
      if (letter === SSH_OPTION_LETTER && !SSH_OPTION_KEYS.has(SSH_OPTION_KEY.exec(optionValue)?.[1].toLowerCase() ?? '')) return false;
      break;
    }
  }
  return true;
}

/** The `GIT_CONFIG_KEY_n` / `GIT_CONFIG_PARAMETERS` among these `name=value` settings that runs a program, or undefined. */
function runVariable(settings: ReadonlyArray<readonly [string, string]>): string | undefined {
  const found = settings.find(([name, value]) => {
    if (name === 'GIT_CONFIG_PARAMETERS') return true;
    if (!CONFIG_KEY_VARIABLE.test(name)) return false;
    const paired = settings.find(([other]) => other === name.replace('_KEY_', '_VALUE_'));
    return runsProgram(value, paired?.[1]);
  });
  return found?.[0];
}

/**
 * Variables git (or the ssh it runs) takes a program from (git and ssh syntax), on any subcommand
 * (fix round 4, K5). git falls back to `VISUAL` and `EDITOR` when no git editor is set.
 */
const PROGRAM_VARIABLES = new Set([
  'GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_EXTERNAL_DIFF', 'GIT_ASKPASS', 'SSH_ASKPASS',
  'GIT_PAGER', 'GIT_PROXY_COMMAND', 'EDITOR', 'VISUAL',
]);
/** Pager settings (git syntax) and the values that page with nothing the agent wrote. */
const PAGER_VARIABLES = new Set(['GIT_PAGER', 'PAGER']);
const PAGER_VALUES = new Set([...NO_PROGRAM_VALUES, 'cat']);
/** Variables that point git at another config file (git and XDG syntax); `/dev/null` only turns one off. */
const CONFIG_FILE_VARIABLES = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG', 'HOME', 'XDG_CONFIG_HOME']);
const NO_CONFIG_FILE = '/dev/null';

/** The program variable among these settings set to something other than a harmless value, or undefined. */
function programVariable(settings: ReadonlyArray<readonly [string, string]>): string | undefined {
  return settings.find(([name, value]) => {
    if (!PROGRAM_VARIABLES.has(name)) return false;
    if (SSH_VARIABLES.has(name)) return !harmlessSsh(value);
    return !(PAGER_VARIABLES.has(name) ? PAGER_VALUES : NO_PROGRAM_VALUES).has(value);
  })?.[0];
}

/** The settings in force for a part: its own, then those an earlier assignment alone or `export` left for the rest of the call. */
function callSettings(part: CommandPart, earlier: readonly CommandPart[], count: number): Array<readonly [string, string]> {
  const settings = settingsOf(part);
  for (let i = 0; i < count; i++) {
    // only an assignment alone or an `export` lasts past its own command
    if (earlier[i].program === null || VARIABLE_SETTERS.has(earlier[i].program ?? '')) settings.push(...settingsOf(earlier[i]));
  }
  return settings;
}

/** The `name=value` settings a part makes: its own assignments, or those its `export` words make. */
function settingsOf(part: CommandPart): Array<readonly [string, string]> {
  const own = part.assignments.map((name, n) => [name, part.assignmentValues[n] ?? ''] as const);
  if (part.program === null || !VARIABLE_SETTERS.has(part.program)) return own;
  return [...own, ...part.words.slice(1).map((w) => [w.split('=')[0], w.slice(w.indexOf('=') + 1)] as const)];
}

/**
 * What makes this git subcommand, whichever it is, run a hook folder or program the agent may have
 * written (fix round 4, K4), or null: a `git -c` or `--config-env` setting such a key, or a
 * `GIT_CONFIG_KEY_n` naming one (or `GIT_CONFIG_PARAMETERS`) set for it or earlier in the call.
 */
function runConfig(part: CommandPart, earlier: readonly CommandPart[], count: number): string | null {
  const git = part.git;
  // a push refuses any config it carries, or set earlier, on its own (`carriedSetup`, `setupChange`)
  if (git === null || git.subcommand === 'push') return null;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const env = w === '--config-env' ? globals[i + 1] : w.startsWith('--config-env=') ? w.slice('--config-env='.length) : undefined;
    if (env !== undefined && runsProgram(keyOf(env), undefined)) return keyOf(env);
    if (w !== '-c' || i + 1 >= globals.length) continue;
    const setting = globals[++i];
    const value = setting.includes('=') ? setting.slice(setting.indexOf('=') + 1) : 'true';
    if (runsProgram(keyOf(setting), value)) return keyOf(setting);
  }
  const settings = callSettings(part, earlier, count);
  const variable = runVariable(settings) ?? programVariable(settings);
  if (variable !== undefined) return variable;
  // a commit refuses these on its own (`checkCommitSetup`)
  if (git.subcommand === 'commit') return null;
  return settings.find(([name, value]) => CONFIG_FILE_VARIABLES.has(name) && value !== NO_CONFIG_FILE)?.[0] ?? null;
}

/**
 * The options that name the program the other side runs (upload-pack, or receive-pack for push),
 * per subcommand (git syntax). git takes any unambiguous
 * prefix of a long option and refuses an ambiguous one, so any prefix of three or more counts.
 */
const PROGRAM_OPTIONS = new Map<string, readonly string[]>([
  ['fetch', ['--upload-pack']],
  ['pull', ['--upload-pack']],
  ['ls-remote', ['--upload-pack', '--exec']],
  ['clone', ['--upload-pack']],
  ['push', ['--receive-pack', '--exec']],
]);

/**
 * The option by which a fetch, pull, ls-remote, clone or push names the program it runs for the
 * other side, which runs here for a local remote (fix round 4, K5), or null. Only clone's `-u` is
 * that option (`fetch -u` and `push -u` mean something else).
 */
function uploadProgram(part: CommandPart): string | null {
  const git = part.git;
  const options = git === null ? undefined : PROGRAM_OPTIONS.get(git.subcommand);
  if (git === null || options === undefined) return null;
  for (const a of git.args) {
    if (a === '--') break;
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (a.startsWith('--') && options.some((o) => longOption(a, o, 3))) return flag;
    if (git.subcommand === 'clone' && a.startsWith('-u')) return '-u';
  }
  return null;
}

/** The pager config keys (git syntax, lowercased). */
const PAGER_KEYS = ['core.pager', 'pager.*'];

/**
 * The pager setting git would run when it has a terminal of its own (under `script`, `unbuffer` or
 * an `expect` spawn: fix round 4, K5 and K6), or null: a `-c` / `--config-env` pager key, or a
 * `GIT_PAGER` / `PAGER` set for it or earlier in the call, whose value is not a harmless one.
 * Without a terminal git starts no pager, so pager settings pass elsewhere.
 */
function fakeTtyPager(part: CommandPart, earlier: readonly CommandPart[], count: number): string | null {
  const git = part.git;
  if (!part.terminal || git === null) return null;
  const set = callSettings(part, earlier, count).find(([name, value]) => PAGER_VARIABLES.has(name) && !PAGER_VALUES.has(value));
  if (set !== undefined) return set[0];
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const env = w === '--config-env' ? globals[i + 1] : w.startsWith('--config-env=') ? w.slice('--config-env='.length) : undefined;
    if (env !== undefined && keyMatches(PAGER_KEYS, keyOf(env))) return keyOf(env);
    const setting = w === '-c' ? globals[i + 1] : undefined;
    if (setting === undefined || !keyMatches(PAGER_KEYS, keyOf(setting))) continue;
    if (!PAGER_VALUES.has(setting.includes('=') ? setting.slice(setting.indexOf('=') + 1) : 'true')) return keyOf(setting);
  }
  return null;
}
