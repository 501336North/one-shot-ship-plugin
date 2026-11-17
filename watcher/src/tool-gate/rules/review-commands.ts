/**
 * Word-level facts the gate-agent-write rule needs about a command part: which git, gh and
 * package-manager commands only read, which launches outlive the call, which script an interpreter
 * runs. Pure functions of the part's words; where a command is in the file system is the rule's job.
 * Every table is a Map or Set, so a command word that is also an object property name
 * (`constructor`, `__proto__`) is just a word.
 */

import { runsScriptFile, sedFacts } from '../sed-awk.js';
import { expansionSet } from '../expansion-scan.js';
import path from 'node:path';
import type { CommandPart } from '../command-reader.js';

/** The option's name: the word up to `=`. */
export function optionName(word: string): string {
  const eq = word.indexOf('=');
  return eq === -1 ? word : word.slice(0, eq);
}

/** The values a word list gives an option: `--opt value` or `--opt=value`. */
export function optionValues(words: readonly string[], names: readonly string[]): string[] {
  const values: string[] = [];
  words.forEach((word, i) => {
    const name = optionName(word);
    if (!names.includes(name)) return;
    const value = name === word ? words[i + 1] : word.slice(name.length + 1);
    if (value !== undefined) values.push(value);
  });
  return values;
}

/** The positional words, skipping options and the next word after any option in `valueOptions`. */
export function positionals(words: readonly string[], valueOptions: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (valueOptions.has(words[i])) i++;
    else if (!words[i].startsWith('-')) found.push(words[i]);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Launches that outlive the call

/**
 * Programs that keep work running after the call. Those in LASTING schedule work for later, hand it
 * to the system, or start a nested session no rule sees; the rest run it in the background here.
 */
const LAUNCHERS = new Set([
  'nohup', 'setsid', 'disown', 'screen', 'tmux', 'daemonize', 'coproc', 'pm2', 'forever',
]);
const LASTING = new Set([
  'at', 'batch', 'launchctl', 'crontab', 'systemd-run', 'claude', 'start-stop-daemon', 'open', 'osascript', 'xdg-open', 'launchd',
]);
/** ssh options that take a value (OpenSSH 9): in a cluster, the rest of the word or the next word is it. */
const SSH_VALUE_LETTERS = new Set([...'BbcDEeFIiJLlmOoPpQRSWw']);
const CONTAINER_PROGRAMS = new Set(['docker', 'podman']);
const BREW_STARTS = new Set(['start', 'run', 'restart']);
const CONTAINER_GLOBAL_VALUES = new Set(['-H', '--host', '-c', '--context', '--config', '-l', '--log-level', '--url', '--connection']);
const DETACH = /^-[A-Za-z]*d[A-Za-z]*$/;

/** True when `ssh` goes to the background after authenticating (`-f`, in any option cluster before the host). */
function sshInBackground(args: readonly string[]): boolean {
  for (let i = 0; i < args.length && args[i].startsWith('-'); i++) {
    const word = args[i];
    if (word.startsWith('--')) continue;
    for (let k = 1; k < word.length; k++) {
      if (word[k] === 'f') return true;
      if (SSH_VALUE_LETTERS.has(word[k])) {
        if (k === word.length - 1) i++;
        break;
      }
    }
  }
  return false;
}

/** True when a docker/podman call leaves a container running: `run -d`, `start`, `compose up -d`. */
function containerDetached(args: readonly string[]): boolean {
  const [first, second, third] = positionals(args, CONTAINER_GLOBAL_VALUES);
  const sub = first === 'container' ? second : first;
  const detached = args.some((w) => w === '--detach' || w.startsWith('--detach=') || DETACH.test(w));
  if (sub === 'start') return true;
  if (sub === 'run') return detached;
  return first === 'compose' && (second === 'up' || third === 'up') && detached;
}

function sudoInBackground(options: readonly string[]): boolean {
  return options.some((w) => w === '--background' || (!w.startsWith('--') && /^-[A-Za-z]*b/.test(w)));
}

/**
 * How the part keeps work running after the call ends: `background` when it runs it in the
 * background here (`&`, nohup, tmux, `ssh -f`, a detached container …), `lasting` when it schedules
 * it, hands it to the system or starts a nested `claude` session; null when it doesn't.
 */
export function launchOf(part: CommandPart): 'background' | 'lasting' | null {
  const names = [part.name, ...part.wrappers];
  if (names.some((name) => name !== null && LASTING.has(name))) return 'lasting';
  if (part.name === 'brew' && brewServiceStart(part.words.slice(1))) return 'lasting';
  if (part.backgrounded || names.some((name) => name !== null && LAUNCHERS.has(name))) return 'background';
  if (part.wrappers.some((name, i) => name === 'sudo' && sudoInBackground(part.wrapperOptions[i] ?? []))) return 'background';
  return backgroundProgram(part) ? 'background' : null;
}

/** `brew services start|run|restart`: hands a service to launchd, past the run. */
function brewServiceStart(args: readonly string[]): boolean {
  const [first, second] = args.filter((w) => !w.startsWith('-'));
  return first === 'services' && second !== undefined && BREW_STARTS.has(second);
}

/** True for a program that sends its own work to the background (`ssh -f`, `docker run -d`, `emacs --daemon`). */
function backgroundProgram(part: CommandPart): boolean {
  const args = part.words.slice(1);
  if (part.name === 'ssh') return sshInBackground(args);
  if (part.name !== null && CONTAINER_PROGRAMS.has(part.name)) return containerDetached(args);
  if (part.name === 'docker-compose' || part.name === 'podman-compose') return args.includes('up') && args.some((w) => w === '--detach' || DETACH.test(w));
  if (part.name === 'emacs') return args.some((w) => ['--daemon', '--bg-daemon'].includes(optionName(w)));
  return false;
}

// ---------------------------------------------------------------------------------------------
// Interpreters and the script they run

const INTERPRETERS = new Set([
  'node', 'nodejs', 'deno', 'bun', 'tsx', 'ts-node', 'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'source', '.', 'ruby', 'perl', 'php',
]);
const PYTHON = /^python[0-9.]*$/;
/** Interpreter options that take the next word as their value (node, python, shells). */
const INTERPRETER_VALUES = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '-e', '--eval', '-p', '--print', '-c', '-m', '-o', '-O',
  '-W', '-X', '--rcfile', '--init-file',
]);

export function isInterpreter(name: string | null): boolean {
  return name !== null && (INTERPRETERS.has(name) || PYTHON.test(name));
}

/** The script file an interpreter part runs (its first positional word), or null. */
export function scriptArgument(part: CommandPart): string | null {
  if (!isInterpreter(part.name)) return null;
  return positionals(part.words.slice(1), INTERPRETER_VALUES)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// git

/** git subcommands that only read. */
const READ_ONLY_GIT = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'ls-remote', 'rev-parse', 'rev-list', 'cat-file',
  'describe', 'shortlog', 'merge-base', 'name-rev', 'for-each-ref', 'show-ref', 'diff-tree', 'diff-index', 'diff-files',
  'whatchanged', 'check-ignore', 'check-attr', 'var', 'version', 'help', 'count-objects', 'range-diff', 'cherry',
  'verify-commit', 'verify-tag',
]);

/** The list forms of the subcommands that also change things: the first word they may start with. */
const LIST_FIRST_WORDS = new Map<string, ReadonlySet<string>>([
  ['stash', new Set(['list', 'show'])],
  ['worktree', new Set(['list'])],
  ['notes', new Set(['list', 'show'])],
  ['submodule', new Set(['status', 'summary'])],
]);

/** `git branch` list options, and those of them that take a value (next word or `=value`). */
const BRANCH_FLAGS = new Set([
  '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--list', '-l', '--show-current', '--column', '--no-column',
  '--color', '--no-color',
]);
const BRANCH_VALUES = new Set(['--contains', '--merged', '--no-merged', '--format', '--sort', '--points-at']);
const TAG_FLAGS = new Set(['-l', '--list']);
const TAG_VALUES = new Set(['--contains', '--points-at', '--sort', '--format']);
const CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l']);
const CONFIG_MODIFIERS = new Set(['--show-origin', '--show-scope', '--name-only']);
/** `git config` long options that pick a config file outside the repo; git takes any unique prefix (`--glob`). */
const CONFIG_FILE_OPTIONS = ['global', 'system', 'file'];

/** True when the words are only options from `flags`/`values` (a value word may follow), and positional words only with `--list`. */
function listOnly(args: readonly string[], flags: ReadonlySet<string>, values: ReadonlySet<string>, listFlags: readonly string[]): boolean {
  let positional = false;
  let listing = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    const name = optionName(word);
    if (listFlags.includes(word)) listing = true;
    if (!word.startsWith('-')) positional = true;
    else if (values.has(name)) {
      if (name === word && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
    } else if (!flags.has(name)) return false;
  }
  return !positional || listing;
}

function readOnlyTag(args: readonly string[]): boolean {
  return listOnly(args.filter((w) => !/^-n[0-9]*$/.test(w)), TAG_FLAGS, TAG_VALUES, ['-l', '--list']);
}

function readOnlyRemote(args: readonly string[]): boolean {
  const rest = args[0] === '-v' || args[0] === '--verbose' ? args.slice(1) : args;
  return rest.length === 0 || rest[0] === 'show' || rest[0] === 'get-url';
}

function readOnlyConfig(args: readonly string[]): boolean {
  const options = args.filter((w) => w.startsWith('-'));
  return options.some((w) => CONFIG_READS.has(w)) && options.every((w) => CONFIG_READS.has(w) || CONFIG_MODIFIERS.has(w));
}

/** True for a `git config` call that may write the user's or the system's config (or another file). */
export function writesUserGitConfig(subcommand: string, args: readonly string[]): boolean {
  return subcommand === 'config' && args.some(namesConfigFile) && !args.some((w) => CONFIG_READS.has(w));
}

/** `-f`, or a long option any prefix of `--global`, `--system` or `--file` (`--glo`, `--fil=x`). */
function namesConfigFile(word: string): boolean {
  if (word === '-f') return true;
  const name = optionName(word);
  return name.startsWith('--') && name.length > 2 && CONFIG_FILE_OPTIONS.some((o) => o.startsWith(name.slice(2)));
}

/** An argument that makes a read-only subcommand write a file or run a program. */
function writingArgument(subcommand: string, args: readonly string[]): boolean {
  return args.some((w) => {
    const name = optionName(w);
    if (name === '--output') return true;
    if (subcommand === 'grep' && (name === '--open-files-in-pager' || /^-[A-Za-z]*O/.test(w))) return true;
    return subcommand === 'ls-remote' && (name === '--upload-pack' || name === '--exec' || w === '-u');
  });
}

export function readOnlyGit(subcommand: string, args: readonly string[]): boolean {
  if (writingArgument(subcommand, args)) return false;
  if (READ_ONLY_GIT.has(subcommand)) return true;
  switch (subcommand) {
    case 'branch':
      return listOnly(args, BRANCH_FLAGS, BRANCH_VALUES, ['-l', '--list']);
    case 'tag':
      return readOnlyTag(args);
    case 'remote':
      return readOnlyRemote(args);
    case 'config':
      return readOnlyConfig(args);
    case 'reflog':
      return args.length === 0 || args[0] === 'show';
    case 'symbolic-ref':
      // the read form names one ref; a second operand, -d or -m changes it
      return !args.some((w) => ['-d', '--delete', '-m'].includes(optionName(w))) && args.filter((w) => !w.startsWith('-')).length === 1;
    default:
      return LIST_FIRST_WORDS.get(subcommand)?.has(args[0] ?? '') === true;
  }
}

/** True for git run under another name: `git-<sub>`, any program in git's exec path, or `hub`. */
export function gitByOtherName(part: CommandPart): boolean {
  if (part.name === null || part.program === null) return false;
  return part.name.startsWith('git-') || part.name === 'hub' || part.program.split('/').includes('git-core');
}

// ---------------------------------------------------------------------------------------------
// gh

/** The read-only `gh` commands: group, then the actions that only read. */
const GH_READS = new Map<string, ReadonlySet<string>>([
  ['pr', new Set(['view', 'list', 'diff', 'checks', 'status'])],
  ['issue', new Set(['view', 'list'])],
  ['run', new Set(['view', 'list'])],
]);
const GH_GLOBAL_VALUES = new Set(['-R', '--repo', '--hostname']);
/** `gh api` options that send fields, which makes the default method POST. */
const GH_FIELDS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

/** The method a `gh api` call uses: `-X`/`--method` as given, else POST with fields, else GET. */
function ghApiMethod(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word === '-X' || word === '--method') return (args[i + 1] ?? '').toUpperCase();
    if (word.startsWith('--method=')) return word.slice('--method='.length).toUpperCase();
    if (word.startsWith('-X') && !word.startsWith('--')) return word.slice(2).toUpperCase();
  }
  return args.some((w) => GH_FIELDS.has(optionName(w))) ? 'POST' : 'GET';
}

/** True for a `gh` call that only reads (or names no command: help). */
export function readOnlyGh(args: readonly string[]): boolean {
  const [group, action] = positionals(args, GH_GLOBAL_VALUES);
  if (group === undefined) return true;
  if (group === 'api') return ghApiMethod(args) === 'GET';
  return GH_READS.get(group)?.has(action ?? '') === true;
}

// ---------------------------------------------------------------------------------------------
// Package managers

/**
 * Package-manager subcommands that change installed dependencies, per program (npm's aliases and
 * the misspellings it accepts included). `''` stands for the program run with no subcommand
 * (`yarn`, `bundle` install); two words are matched as `first second` (`npm audit fix`).
 */
const DEPENDENCY_CHANGES = new Map<string, ReadonlySet<string>>([
  ['npm', new Set([
    'install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add',
    'it', 'cit', 'clean-install-test', 'sit', 'install-test', 'install-ci-test',
    'ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean',
    'uninstall', 'un', 'unlink', 'remove', 'rm', 'r',
    'update', 'up', 'upgrade', 'udpate', 'link', 'ln', 'rebuild', 'rb', 'dedupe', 'ddp', 'prune',
    'audit fix', 'pkg set', 'pkg delete',
  ])],
  ['pnpm', new Set(['install', 'i', 'add', 'update', 'up', 'remove', 'rm', 'link', 'rebuild', 'prune', 'import'])],
  ['yarn', new Set(['', 'install', 'add', 'upgrade', 'up', 'remove', 'link', 'import'])],
  ['bun', new Set(['install', 'i', 'add', 'update', 'remove', 'link'])],
  ['pip', new Set(['install', 'uninstall', 'download'])],
  ['uv', new Set(['add', 'remove', 'sync', 'pip install', 'pip sync', 'pip uninstall'])],
  ['poetry', new Set(['install', 'add', 'update', 'remove'])],
  ['gem', new Set(['install'])],
  ['bundle', new Set(['', 'install', 'update'])],
  ['cargo', new Set(['install', 'add', 'update'])],
  ['go', new Set(['get', 'install', 'mod download'])],
]);
/** npm subcommands that install the package they run when given `-p` / `--package`. */
const NPM_EXEC = new Set(['exec', 'x']);
const PACKAGE_OPTIONS = ['-p', '--package'];
/** Package-manager options that name the folder it works in. */
export const PACKAGE_DIR_OPTIONS = ['--prefix', '-C', '--cwd', '--dir'];
const PACKAGE_DIR_VALUES = new Set(PACKAGE_DIR_OPTIONS);
const PIP = /^pip[0-9.]*$/;
/** The package manager a `node <cli file>` call runs, by the file's name. */
const NODE_CLIS: readonly [RegExp, string][] = [
  [/^npm-cli\.c?js$/, 'npm'],
  [/^pnpm\.c?js$/, 'pnpm'],
  [/^yarn(-[0-9][0-9A-Za-z.-]*)?\.c?js$/, 'yarn'],
];

/** The package manager and the words after it a part runs (`pip` for `python -m pip`, npm for `node npm-cli.js`), or null. */
export function packageCommand(part: CommandPart): { manager: string; words: string[] } | null {
  const { name } = part;
  if (name === null) return null;
  const args = part.words.slice(1);
  if (PIP.test(name)) return { manager: 'pip', words: args };
  if (PYTHON.test(name)) {
    const m = args.indexOf('-m');
    return m !== -1 && args[m + 1] === 'pip' ? { manager: 'pip', words: args.slice(m + 2) } : null;
  }
  if (name === 'node' || name === 'nodejs') {
    const script = scriptArgument(part);
    const cli = script === null ? undefined : NODE_CLIS.find(([file]) => file.test(path.posix.basename(script)));
    return cli === undefined || script === null ? null : { manager: cli[1], words: args.slice(args.indexOf(script) + 1) };
  }
  if (name === 'npx') return { manager: 'npx', words: args };
  return DEPENDENCY_CHANGES.has(name) ? { manager: name, words: args } : null;
}

/** True when the package-manager call changes installed dependencies (wherever it runs). */
export function changesInstalled(command: { manager: string; words: string[] }): boolean {
  const [first = '', second = ''] = positionals(command.words, PACKAGE_DIR_VALUES);
  // npx's own options come before the tool it runs; the tool's (`tsc -p`) are the tool's
  const ownOptions = (words: readonly string[]): string[] => {
    const tool = words.findIndex((w) => !w.startsWith('-'));
    return words.slice(0, tool === -1 ? words.length : tool);
  };
  if (command.manager === 'npx') return ownOptions(command.words).some((w) => PACKAGE_OPTIONS.includes(optionName(w)));
  if (command.manager === 'npm' && NPM_EXEC.has(first)) {
    return ownOptions(command.words.slice(command.words.indexOf(first) + 1)).some((w) => PACKAGE_OPTIONS.includes(optionName(w)));
  }
  const changes = DEPENDENCY_CHANGES.get(command.manager);
  return changes !== undefined && (changes.has(first) || changes.has(`${first} ${second}`));
}

// ---------------------------------------------------------------------------------------------
// Variables a review agent may not set

/** Variables that change what runs, where, or how the shell reads a command (zsh's arrays included). */
const RISKY_VARIABLES = new Set([
  'HOME', 'PATH', 'CDPATH', 'IFS', 'ENV', 'BASH_ENV', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS', 'NODE_OPTIONS', 'NODE_PATH',
  'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME', 'PERL5LIB', 'PERL5OPT', 'RUBYOPT', 'RUBYLIB', 'ZDOTDIR', 'path', 'cdpath', 'fpath',
  // round 6 (sec L-A): what a build or test run loads or runs
  'GOFLAGS', 'RUSTC_WRAPPER', 'RUSTFLAGS', 'JAVA_TOOL_OPTIONS', 'MAVEN_OPTS', 'BUNDLE_GEMFILE', 'MAKEFLAGS',
]);
const RISKY_PREFIXES = ['LD_', 'DYLD_', 'GIT_', 'BASH_FUNC_', 'PYTEST_'];
/** cargo's variables that move where it writes or what it runs (round 8, M3: CARGO_TERM_COLOR and its kind are fine). */
const RISKY_CARGO = /^CARGO_(?:TARGET_DIR|HOME|BUILD_.*|.*_RUNNER)$/;
/** A tool's config file or settings named by a variable (`PIP_CONFIG_FILE`, `RUFF_CONFIG`). */
const RISKY_SUFFIX = /_CONFIG(?:_FILE)?$/;
/** Shell builtins that set variables for the rest of the call (found by exact name). */
export const VARIABLE_SETTERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);

/** True for a variable a review agent may not set (`PATH`, `PATH+`, `PATH[0]` all name PATH). */
export function riskyVariable(name: string): boolean {
  const bare = name.replace(/[[+].*$/, '');
  // npm reads its settings from npm_config_* in any letter case (script-shell, prefix, userconfig)
  return (
    RISKY_VARIABLES.has(bare) ||
    RISKY_PREFIXES.some((prefix) => bare.startsWith(prefix)) ||
    RISKY_CARGO.test(bare) ||
    RISKY_SUFFIX.test(bare) ||
    bare.toLowerCase().startsWith('npm_config_')
  );
}

/** The risky variable the part sets (inline, alone, through env or a setter, `printf -v`), or a setter's `-n` (a name reference); else null. */
export function riskyAssignment(part: CommandPart): string | null {
  const inline = part.assignments.find(riskyVariable);
  if (inline !== undefined) return inline;
  const args = part.words.slice(1);
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
    if (args.some((w) => /^-[A-Za-z]*n/.test(w))) return `${part.program} -n`;
    return args.map((w) => w.split('=')[0]).find((w) => !w.startsWith('-') && riskyVariable(w)) ?? null;
  }
  if (part.name === 'printf') return optionValues(args, ['-v']).find(riskyVariable) ?? null;
  return null;
}

/** True when a setter builtin (export, declare …, printf -v, read, mapfile, unset, getopts) names a variable only known when it runs. */
export function setterNameNotLiteral(part: CommandPart, unknown: string): boolean {
  const { program } = part;
  if (program === null) return false;
  const args = part.words.slice(1);
  let names: string[] = [];
  if (VARIABLE_SETTERS.has(program)) names = args.map((w) => (w.startsWith('-') ? w : w.split('=')[0] ?? ''));
  else if (program === 'printf') names = [...optionValues(args, ['-v']), ...args.filter((w) => /^-v./.test(w)).map((w) => w.slice(2))];
  else if (READ_BUILTINS.has(program)) names = [...readNames(program, args), ...args.filter((w) => w.startsWith('-') && w.includes(unknown))];
  else if (program === 'unset') names = args;
  else if (program === 'getopts') names = positionals(args, NO_VALUES).slice(1, 2);
  return names.some((name) => name.includes(unknown));
}

/**
 * The risky variable the command text sets inside an expansion or arithmetic (`${CDPATH:=x}`,
 * `${PATH=x}`, `${HOME::=x}`, `$((IFS=1))`, `((CDPATH=1))`), or null (round 6, sec M-B).
 */
export function riskyExpansionVariable(command: string): string | null {
  return expansionSet(command, riskyVariable);
}

/** The risky variable a `for` or `select` loop in the command text sets, or null. */
export function riskyLoopVariable(command: string): string | null {
  for (const match of command.matchAll(/(?:^|[\s;&|(])(?:for|select)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (riskyVariable(match[1])) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The review allowlist: the forms the gate knows (the rest come from the reviewPrograms setting)

/** Programs that write: allowed, with what they write checked by the write rules. */
const WRITE_TOOLS = new Set(['mkdir', 'rm', 'cp', 'mv', 'touch', 'tee', 'ln']);
/** Wrappers a review agent may run another program under (the program is then checked). */
export const ALLOWED_WRAPPERS = new Set(['timeout', 'nice', 'time', 'env', 'command', 'xargs']);
/** Builtins that only change the shell's folder or its own variables (found by exact name). */
const SHELL_STATE = new Set(['cd', 'pushd', 'popd', 'unset', ':', 'exit', 'return']);
const READ_BUILTINS = new Set(['read', 'mapfile', 'readarray']);
const READ_VALUES = new Set(['-d', '-n', '-N', '-p', '-t', '-u', '-i']);
const MAPFILE_VALUES = new Set(['-d', '-n', '-O', '-s', '-u', '-C', '-c']);

/** The variables a read builtin sets: its operands, and `read -a NAME`'s array. */
function readNames(program: string, args: readonly string[]): string[] {
  if (program !== 'read') return positionals(args, MAPFILE_VALUES);
  return [...positionals(args, new Set([...READ_VALUES, '-a'])), ...optionValues(args, ['-a'])];
}
const VERSION_PROGRAMS = new Set(['node', 'npm', 'pnpm', 'yarn', 'bun']);
const SET_FLAGS = /^[-+][euxvo]+$|^[-+]o$|^(?:pipefail|errexit|nounset|xtrace)$/;
/** find actions that write or run what the allowlist doesn't see. */
const FIND_WRITES = new Set(['-delete', '-fprint', '-fprint0', '-fprintf', '-fls', '-ok', '-okdir']);
const FIND_RUNS = new Set(['-exec', '-execdir']);

/** The commands a `find` runs with -exec / -execdir: the words up to `;` or `+`. */
export function findExecs(part: CommandPart): string[][] {
  if (part.name !== 'find') return [];
  const args = part.words.slice(1);
  const found: string[][] = [];
  for (let i = 0; i < args.length; i++) {
    if (!FIND_RUNS.has(args[i])) continue;
    const end = args.findIndex((w, k) => k > i && (w === ';' || w === '+'));
    found.push(args.slice(i + 1, end === -1 ? args.length : end));
    if (end === -1) break;
    i = end;
  }
  return found;
}
/** Test-runner options that rewrite snapshot files in the repo. */
const SNAPSHOT_UPDATES = new Set(['-u', '--update', '--updateSnapshot']);
const SED_IN_PLACE = /^-[A-Za-z]*i|^--in-place/;

/** tsc that only checks: --noEmit (no incremental build info), --showConfig, or a dry build. */
function tscChecksOnly(args: readonly string[]): boolean {
  const has = (...names: string[]): boolean => args.some((w) => names.includes(optionName(w)));
  if (has('--init', '--outDir', '--outFile', '--incremental', '-i', '--tsBuildInfoFile', '--generateTrace', '--watch', '-w', '--declarationDir')) return false;
  if (has('-b', '--build')) return has('--dry');
  return has('--noEmit', '--showConfig');
}

/** JS tools a review agent may run (directly, or through npx, bunx, `pnpm exec`, pnpm or yarn), with what each may not do. */
const JS_TOOLS = new Map<string, (args: readonly string[]) => boolean>([
  ['tsc', tscChecksOnly],
  ['eslint', () => true],
  ['prettier', (args) => args.some((w) => ['--check', '-c', '--list-different', '-l'].includes(w)) && !args.includes('-w')],
  ['biome', () => true],
]);
const JS_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const RUN_SCRIPT = new Set(['run', 'run-script']);
/** Package-manager subcommands that only read. */
const PACKAGE_READS = new Map<string, ReadonlySet<string>>([
  ['npm', new Set(['audit', 'ls', 'list', 'outdated', 'view', 'info', 'why', 'explain', 'find-dupes'])],
  ['pnpm', new Set(['audit', 'ls', 'list', 'why', 'outdated'])],
  ['yarn', new Set(['audit', 'why', 'info', 'list'])],
  ['pip', new Set(['list', 'show', 'freeze', 'check'])],
  ['pip3', new Set(['list', 'show', 'freeze', 'check'])],
]);
/** Native toolchains: the subcommands that build, check or test. */
const TOOLCHAINS = new Map<string, ReadonlySet<string>>([
  ['go', new Set(['build', 'vet', 'test', 'list', 'version', 'env'])],
  ['cargo', new Set(['build', 'check', 'clippy', 'test'])],
  ['swift', new Set(['build', 'test'])],
]);
const CURL_WRITES = new Set([
  '--output', '--remote-name', '--remote-name-all', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--libcurl',
  '--output-dir', '--create-dirs', '--config', '--etag-save', '--hsts', '--alt-svc', '--stderr',
]);
/** curl options that send data, upload or use stored credentials; wget's that send. */
const CURL_SENDS = /^--(?:data.*|json|form.*|upload-file|netrc.*)$/;
const WGET_SENDS = /^--(?:post-data|post-file|method|body-data|body-file)$/;
/** wget options that run its own commands, read another config, or write a file beside the page. */
const WGET_WRITES = ['--execute', '--config', '--save-cookies', '--warc-file', '--rejected-log', '--hsts-file', '--output-file', '--append-output', '--directory-prefix'];
/** Real long options that are also the start of a write option (`--json`, `--json-output`): never read as shortened. */
const REAL_SHORT_LONG = new Set(['--json', '--sarif', '--cov']);
/** GNU programs whose getopt_long takes any unambiguous prefix, one letter on (`sort --o=x`, round 6, CR M1). */
export const GETOPT_PROGRAMS: ReadonlySet<string> = new Set(['sort', 'date', 'file', 'uniq', 'wget', 'tar', 'gtar']);

/**
 * True when the word is the long option, or a shortening getopt_long and argparse accept (a
 * prefix of at least `shortest` letters after `--`: three in general (round 5, sec H2), one for
 * the GNU programs).
 */
export function longOptionMatch(word: string, option: string, shortest = 3): boolean {
  const name = optionName(word);
  if (name === option) return true;
  return option.startsWith('--') && name.startsWith('--') && name.length >= 2 + shortest && option.startsWith(name) && !REAL_SHORT_LONG.has(name);
}
const NO_VALUES: ReadonlySet<string> = new Set();

/** Options that take the next word as their value, for the programs whose subcommand follows them (`mvn -pl core test`). */
const MAVEN_VALUES = ['-pl', '--projects', '-f', '--file', '-P', '--activate-profiles', '-D', '-s', '--settings', '-T', '--threads', '-rf', '--resume-from'];
const GRADLE_VALUES = ['-p', '--project-dir', '-b', '--build-file', '-x', '--exclude-task', '--tests', '--max-workers'];
const VALUE_OPTIONS = new Map<string, ReadonlySet<string>>([
  ['mvn', new Set(MAVEN_VALUES)],
  ['mvnw', new Set(MAVEN_VALUES)],
  ['gradle', new Set(GRADLE_VALUES)],
  ['gradlew', new Set(GRADLE_VALUES)],
  ['go', new Set(['-C'])],
  ['xcodebuild', new Set(['-scheme', '-destination', '-project', '-workspace', '-configuration', '-sdk', '-target', '-testPlan', '-only-testing', '-skip-testing', '-arch', '-resultBundlePath', '-derivedDataPath', '-enableCodeCoverage'])],
  ['kubectl', new Set(['-n', '--namespace', '--context', '-l', '--selector', '-o', '--output', '--kubeconfig', '-c', '--container'])],
  ['docker', new Set(['-f', '--file', '-p', '--project-name', '-H', '--host', '--context', '--profile', '--env-file'])],
  ['trivy', new Set(['--severity', '--format', '-f', '-s', '--scanners', '--skip-dirs', '--timeout'])],
  ['uniq', new Set(['-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars'])],
  ['xxd', new Set(['-c', '-cols', '-g', '-groupsize', '-l', '-len', '-s', '-seek', '-o', '-offset', '-n', '-name'])],
  ['pnpm', new Set(['--filter', '-F', '-C', '--dir', '--workspace-dir'])],
  ['yarn', new Set(['--cwd'])],
]);

/**
 * Programs whose options are single-dash words (`go test -cover`, `mvn -pl`, `xcodebuild -scheme`):
 * a one-letter write option of theirs is matched only as written, never inside a word.
 */
export const SINGLE_DASH_LONG: ReadonlySet<string> = new Set(['go', 'gofmt', 'terraform', 'javac', 'java', 'xcodebuild', 'mvn', 'mvnw', 'find', 'kubectl', 'docker']);

/**
 * Build tools that run every goal or task they are given: each must build, check or test
 * (`mvn test deploy` deploys). Gradle's `:project:task` is judged by its task.
 */
const MAVEN_GOALS = new Set(['validate', 'compile', 'test-compile', 'test', 'verify', 'clean', 'dependency:tree', 'dependency:list', 'dependency:analyze', 'help:effective-pom']);
const GRADLE_TASK = /^(?:test|check|build|assemble|compile|lint|dependencies|dependencyInsight|clean|tasks|projects|properties|help)[A-Za-z0-9]*$|^[a-z][A-Za-z0-9]*(?:Check|Test|Report)$|^detekt$/;
/** A Maven plugin's check or report goal (`checkstyle:check`, `jacoco:report`). */
const MAVEN_CHECK_GOAL = /^[A-Za-z0-9.-]+:(?:check|report)$/;
const GRADLE_WRITES = /Fix|Format|Apply|Update|Publish|Install|Upload|Deploy|Release|Baseline|Wrapper/;
const GOALS = new Map<string, (goal: string) => boolean>([
  ['mvn', (g) => MAVEN_GOALS.has(g) || MAVEN_CHECK_GOAL.test(g)],
  ['mvnw', (g) => MAVEN_GOALS.has(g) || MAVEN_CHECK_GOAL.test(g)],
  ['gradle', gradleTask],
  ['gradlew', gradleTask],
  ['xcodebuild', (g) => ['build', 'test', 'build-for-testing', 'test-without-building', 'analyze', 'clean'].includes(g) || buildSetting(g)],
  ['rake', (g) => g === 'test' || g === 'spec'],
]);

function gradleTask(word: string): boolean {
  const task = word.slice(word.lastIndexOf(':') + 1);
  return GRADLE_TASK.test(task) && !GRADLE_WRITES.test(task);
}

/** An xcodebuild build setting (`CODE_SIGNING_ALLOWED=NO`) that doesn't move where it writes. */
function buildSetting(word: string): boolean {
  const eq = word.indexOf('=');
  return eq > 0 && !/(?:ROOT|DIR|PATH|LOCATION)$/.test(word.slice(0, eq));
}

/** For a build tool that runs every goal it is given: true when each goal builds, checks or tests; null for any other program. */
export function goalsAllowed(name: string, args: readonly string[]): boolean | null {
  const allowed = GOALS.get(name);
  if (allowed === undefined) return null;
  const goals = positionals(args, valueOptionsOf(name));
  // no goal at all (`xcodebuild -list`): the entries decide
  return goals.length === 0 ? null : goals.every(allowed);
}

/** The options of a program that take the next word as their value (none known: an empty set). */
export function valueOptionsOf(name: string): ReadonlySet<string> {
  return VALUE_OPTIONS.get(name) ?? NO_VALUES;
}

function jsTool(tool: string | undefined, args: readonly string[]): boolean {
  const check = tool === undefined ? undefined : JS_TOOLS.get(tool);
  return check !== undefined && check(args);
}

/** True for a JS tool the gate knows (tsc, eslint, prettier, biome), whatever it is given. */
export function isJsTool(name: string): boolean {
  return JS_TOOLS.has(name);
}

/** A build, lint, type-check or read-only package command. */
function buildForm(name: string, args: readonly string[]): boolean {
  if (JS_TOOLS.has(name)) return jsTool(name, args);
  if (name === 'make') return true;
  const [first, second] = positionals(args, valueOptionsOf(name));
  const toolchain = TOOLCHAINS.get(name);
  if (toolchain !== undefined) return first !== undefined && toolchain.has(first);
  if (PACKAGE_READS.get(name)?.has(first ?? '') === true) return second !== 'fix';
  if (!JS_RUNNERS.has(name)) return false;
  if (first !== undefined && RUN_SCRIPT.has(first)) return second !== undefined;
  if (name === 'npm' && first === 'pkg') return second === 'get';
  // a script run without `run` (pnpm lint), for the script names checks use
  return (name === 'pnpm' || name === 'yarn') && first !== undefined && checkScriptName(first);
}

/** True when pnpm or yarn's first word runs a package script (`run lint`, or a script name such as `test`). */
export function scriptRun(first: string): boolean {
  return RUN_SCRIPT.has(first) || checkScriptName(first);
}

/**
 * Script name parts (split on `:`, `-`, `_`, `.` and camelCase) that say the script changes things,
 * and those that say it only checks (round 6, CR M4; round 8, H2/M1). fix, write, deploy, release,
 * publish, migrate and seed always change things unless the name also says dry-run; the others
 * (format, update, prepare) are a check when a part is check or verify. `ci` says nothing either way,
 * and `lint` only as the whole name.
 */
const CHANGING_PARTS = new Set(['fix', 'write', 'format', 'update', 'deploy', 'release', 'publish', 'migrate', 'seed', 'prepare']);
const WRITING_PARTS = new Set(['fix', 'write', 'deploy', 'release', 'publish', 'migrate', 'seed']);
const CHECKING_PARTS = new Set(['check', 'verify']);
/** Parts that name a check, for a script run by its bare name (`pnpm format:check`, `yarn prettier:check`). */
const CHECK_NAME_PARTS = new Set(['check', 'verify', 'ci', 'lint', 'test', 'typecheck', 'build']);

function scriptParts(script: string): string[] {
  return script.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[:_.\s-]/);
}

function dryRun(script: string): boolean {
  return /dry[-_:]?run/i.test(script);
}

/** True when a script's name says it changes things. */
export function changingScript(script: string): boolean {
  const parts = scriptParts(script);
  if (!parts.some((p) => CHANGING_PARTS.has(p)) || dryRun(script)) return false;
  if (parts.some((p) => WRITING_PARTS.has(p))) return true;
  return !parts.some((p) => CHECKING_PARTS.has(p)) && !(parts.length === 1 && parts[0] === 'lint');
}

/** True when a package manager's call runs a script whose name says it changes things. */
function runsChangingScript(name: string, args: readonly string[]): boolean {
  return changingScriptRun(name, args) !== null;
}

/** The package script a JS runner (`npm run deploy`, `pnpm db:seed`) runs whose name says it changes things, or null. */
export function changingScriptRun(name: string, args: readonly string[]): string | null {
  if (!JS_RUNNERS.has(name)) return null;
  const [first, second] = positionals(args, valueOptionsOf(name));
  const script = first !== undefined && RUN_SCRIPT.has(first) ? second : first;
  return script !== undefined && changingScript(script) ? script : null;
}

/** True for a script name run without `run` that names a check and nothing that changes things. */
function checkScriptName(script: string): boolean {
  return SCRIPT_NAMES.test(script) || (scriptParts(script).some((p) => CHECK_NAME_PARTS.has(p)) && !changingScript(script) && /^[A-Za-z0-9:_-]+$/.test(script));
}

/** Script names a review agent may run without `run` (pnpm and yarn run a package script by its name). */
const SCRIPT_NAMES = /^(?:test|lint|typecheck|type-check|check|build|verify)(?::[A-Za-z0-9:_-]+)?$/;

/** curl that prints (no option that writes a file), wget that prints to stdout or only checks. */
function fetchForm(name: string, args: readonly string[]): boolean {
  const shortHas = (letters: RegExp): boolean => args.some((w) => !w.startsWith('--') && w.startsWith('-') && letters.test(w.slice(1)));
  if (name === 'curl') {
    // only fetches: no file written (output to /dev/null aside), nothing sent (data, form, upload, a
    // method other than GET/HEAD), no stored credentials, no `-w '%output{file}'`
    const rest = withoutDevNull(args);
    const methods = [...optionValues(rest, ['-X', '--request']), ...rest.filter((w) => /^-X./.test(w)).map((w) => w.slice(2))];
    const formats = [...optionValues(rest, ['-w', '--write-out']), ...rest.filter((w) => /^-w./.test(w)).map((w) => w.slice(2))];
    const short = (letters: RegExp): boolean => rest.some((w) => !w.startsWith('--') && w.startsWith('-') && letters.test(w.slice(1)));
    return (
      !rest.some((w) => CURL_WRITES.has(optionName(w)) || CURL_SENDS.test(optionName(w))) &&
      !short(/[oODcKdFTn]/) &&
      methods.every((m) => m === 'GET' || m === 'HEAD') &&
      !formats.some((f) => f.includes('%output{') || f.startsWith('@'))
    );
  }
  if (name !== 'wget') return false;
  if (args.some((w) => WGET_SENDS.test(optionName(w)) || WGET_WRITES.some((o) => longOptionMatch(w, o))) || shortHas(/e/)) return false;
  const prints = args.includes('--spider') || args.includes('--output-document=-') || args.some((w, i) => /^-[A-Za-z]*O-$/.test(w) || (/^-[A-Za-z]*O$/.test(w) && args[i + 1] === '-'));
  const logs = args.some((w) => ['--output-file', '--append-output', '--directory-prefix'].includes(optionName(w))) || shortHas(/[oaP]/);
  return prints && !logs;
}

/** curl's words without an output to /dev/null (`-o /dev/null`, `-so /dev/null`, `--output=/dev/null`, `-o/dev/null`). */
function withoutDevNull(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if ((w === '--output' || /^-[A-Za-z]*o$/.test(w)) && args[i + 1] === '/dev/null') {
      if (w.length > 2 && !w.startsWith('--')) out.push(w.slice(0, -1));
      i++;
    } else if (w === '--output=/dev/null' || /^-[A-Za-z]*o\/dev\/null$/.test(w)) {
      const head = w.startsWith('--') ? '' : w.slice(0, w.indexOf('o/dev/null'));
      if (head.length > 1) out.push(head);
    } else {
      out.push(w);
    }
  }
  return out;
}

/** True for the forms the gate knows, by the part's words alone (interpreters and named programs are the rule's). */
export function knownForm(part: CommandPart, testCommandPatterns: readonly string[], matches: (pattern: string, words: string[]) => boolean): boolean {
  const { name, program } = part;
  if (name === null || program === null) return true;
  const args = part.words.slice(1);
  if (SHELL_STATE.has(program) || VARIABLE_SETTERS.has(program)) return true;
  if (runsChangingScript(name, args)) return false;
  if (program === 'set') return args.every((w) => SET_FLAGS.test(w));
  // a read loop reads into its own variables (the rule refuses risky names and redirects out)
  if (READ_BUILTINS.has(program)) return part.writeTargets.length === 0 && !readNames(program, args).some(riskyVariable);
  if (VERSION_PROGRAMS.has(name) && args.length === 1 && (args[0] === '--version' || args[0] === '-v')) return true;
  if (name === 'git' && part.git !== null) return true;
  if (name === 'gh' || WRITE_TOOLS.has(name)) return true;
  // a test run may not rewrite the repo's snapshots
  if (testCommandPatterns.some((pattern) => matches(pattern, part.words))) return !args.some((w) => SNAPSHOT_UPDATES.has(optionName(w)));
  if (isInterpreter(name) && !JS_RUNNERS.has(name)) return false;
  return buildForm(name, args) || fetchForm(name, args);
}

/** For a program from reviewPrograms: the ways it may not be used (find writing, sed in place or running a command); what find -exec runs is the rule's. */
export function namedProgramMisused(part: CommandPart): boolean {
  const args = part.words.slice(1);
  // sed in place, or with a script file the gate doesn't read (its `w` command writes)
  // or with an `e` command, which runs text as a shell command (round 5, sec M2)
  if (part.name === 'sed') {
    const facts = sedFacts([...args]);
    return args.some((w) => SED_IN_PLACE.test(w)) || runsScriptFile('sed', [...args]) || facts.commands.length > 0 || facts.unreadable !== null;
  }
  // `uniq IN OUT` and `xxd IN OUT` write OUT
  if (part.name === 'uniq' || part.name === 'xxd') return positionals(args, valueOptionsOf(part.name)).length > 1;
  if (part.name !== 'find') return false;
  return args.some((w) => FIND_WRITES.has(w));
}

/** The interpreter forms a review agent may run: inline code, a test run, or a script file (the rule checks the file). */
export function interpreterForm(part: CommandPart): 'inline' | 'script' | null {
  const args = part.words.slice(1);
  const { name } = part;
  if (name === 'node' || name === 'nodejs') {
    if (args.some((w) => ['-e', '--eval', '-p', '--print', '--test'].includes(optionName(w)))) return 'inline';
  } else if (name !== null && PYTHON.test(name)) {
    if (args.includes('-c')) return 'inline';
    if (args.includes('-m')) return null; // a module run: a test run from testCommandPatterns, or nothing
  } else if (name === 'ruby' || name === 'php') {
    if (args.some((w) => w.startsWith('-'))) return null; // ruby -e, php -r: inline code; php -l is a reviewPrograms entry
  } else if (name === 'bash' || name === 'sh') {
    if (args.some((w) => /^-[A-Za-z0-9]*c/.test(w))) return 'inline';
    if (args.some((w) => /^-[A-Za-z0-9]*s/.test(w) || w === '-')) return null;
  } else {
    return null;
  }
  const script = scriptArgument(part);
  return script === null || script.startsWith('/dev/') ? null : 'script';
}

/** True when the pen tester's job control names only its own jobs (`%1`, `$!`, signals). */
export function ownJobs(args: readonly string[], unknown: string): boolean {
  return args.length > 0 && args.every((w) => w.startsWith('%') || w.startsWith('-') || w.includes(unknown));
}
