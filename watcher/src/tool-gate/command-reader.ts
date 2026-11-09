/**
 * Command reader for the tool gate.
 *
 * Turns a tokenized shell command into one set of facts per part: the program and its words,
 * the directory it runs in (after `cd`, `( … )` and `git -C`), the files it writes or removes,
 * the hosts it talks to, and whether its result is hidden by a pipe or `|| true`.
 * It looks through wrappers (`sudo`, `env`, `timeout` …) and reads literal `sh -c` / `eval`
 * scripts recursively (ADR-009). Pure: it never touches the filesystem.
 */

import path from 'node:path';
import { tokenize, type Token } from './tokenize.js';

export interface CommandPart {
  /** After stripping leading VAR=value assignments; words[0] is the program. */
  words: string[];
  /** Exactly words[0], or null when the part has no words. */
  program: string | null;
  /** Absolute directory this part runs in. */
  cwd: string;
  /** Absolute paths this part writes or removes. */
  writeTargets: string[];
  /** Lowercased hostnames, without ports. */
  hosts: string[];
  git: { subcommand: string; args: string[]; dir: string } | null;
  /** This part's stdout goes into `|` or `|&`. */
  pipedOut: boolean;
  /** This part is followed by `|| true` or `|| :`. */
  orTrue: boolean;
}

export interface CommandFacts {
  parts: CommandPart[];
}

/** An operator that ends a segment (or a `( … )` group holding it), and the index of the segment after it. */
interface Exit {
  op: string | null;
  following: number;
}

interface Segment {
  words: string[];
  redirects: { op: string; target: string }[];
  cwd: string;
  /** The segment's own exit first, then those of the `( … )` groups it sits in. */
  exits: Exit[];
}

/** How a wrapper program's options are read before the program it runs. */
interface WrapperSpec {
  /** Options that take a value (`-u root`, `-uroot`, `--user=root`). */
  values: string[];
  /** Options whose value is the directory the program runs in. */
  dir?: string[];
  /** Options whose value is split into the program's words (`env -S`). */
  split?: string[];
  /** `VAR=value` words are skipped. */
  assignments?: boolean;
  /** Words to skip after the options (`timeout 10`). */
  operands?: number;
}

const WRAPPERS = new Map<string, WrapperSpec>([
  ['env', {
    values: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
    dir: ['-C', '--chdir'], split: ['-S', '--split-string'], assignments: true,
  }],
  ['sudo', {
    values: ['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt',
      '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user'],
    dir: ['-D', '--chdir'], assignments: true,
  }],
  ['command', { values: [] }],
  ['builtin', { values: [] }],
  ['nice', { values: ['-n', '--adjustment'] }],
  ['nohup', { values: [] }],
  ['time', { values: ['-f', '--format', '-o', '--output'] }],
  ['xargs', { values: ['-a', '--arg-file', '-d', '--delimiter', '-E', '-I', '-L', '--max-lines', '-n', '--max-args',
    '-P', '--max-procs', '-s', '--max-chars'] }],
  ['exec', { values: ['-a'] }],
  ['doas', { values: ['-u', '-C'] }],
  ['stdbuf', { values: ['-i', '--input', '-o', '--output', '-e', '--error'] }],
  ['timeout', { values: ['-s', '--signal', '-k', '--kill-after'], operands: 1 }],
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
/** Shell options that take the next word as their value; in a cluster (`-eo`), each such letter takes one. */
const SHELL_VALUE_OPTIONS = new Set(['-o', '-O', '--rcfile', '--init-file']);
const SHORT_OPTION_CLUSTER = /^[-+][A-Za-z]+$/;
/** A shell flag cluster that includes `c` (`-c`, `-lc`, `-ec`). */
const COMMAND_STRING_FLAG = /^-[A-Za-z]*c/;
/** A script that substitutes a command or expands a variable or a positional or special parameter is not literal. */
const DYNAMIC_SCRIPT = /\$\(|`|\$[A-Za-z_{0-9@*#?!$-]/;
const MAX_NESTED_DEPTH = 5;
const PIPES = ['|', '|&'];
/** Reserved words that start or end a compound command; skipped where a command starts. */
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', '!']);
/** Words before `cd` that still change the shell's own directory. */
const CD_PREFIXES = new Set(['command', 'builtin', 'time']);

class Unreadable extends Error {}

const OUTPUT_REDIRECT = /^[0-9]*(?:>|>>|>\||<>)$|^&>>?$/;
/** `&1`, `&2-`, `&-`: duplicates or closes another output; not a file. */
const FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
const USER_AT_HOST = /^[^@/\s]+@([^:/\s]+)/;
const BARE_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
/** git global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

export function readCommand(cmd: string, cwd: string, home: string): CommandFacts | { unreadable: true; reason: string } {
  try {
    return { parts: readScript(cmd, cwd, home, 0) };
  } catch (err) {
    if (err instanceof Unreadable) return { unreadable: true, reason: err.message };
    throw err;
  }
}

function readScript(cmd: string, cwd: string, home: string, depth: number): CommandPart[] {
  const result = tokenize(cmd);
  if ('unreadable' in result) throw new Unreadable(result.reason);
  const segments = split(result.tokens, cwd, home);
  return segments.flatMap((segment) => toParts(segment, segments, home, depth));
}

/**
 * Splits tokens into segments on control operators, tracking the directory through `cd`,
 * `pushd`/`popd` and `( … )`. A `cd` that is piped or backgrounded runs apart, so it does not
 * move later segments. Shell keywords where a command starts (`if`, `do`, `{`, `case … in a)`,
 * `for … ;`, `function f`) are skipped, so the commands inside them are read as segments.
 */
function split(tokens: Token[], cwd: string, home: string): Segment[] {
  const segments: Segment[] = [];
  /** `( … )` groups restore the directory they started in; `{ … }` groups (dir null) do not. */
  const groups: { dir: string | null; start: number }[] = [];
  const pushed: string[] = [];
  /** Words skipped up to the next operator (`for` header), up to `in` (`case` header), or one (function name). */
  let header: 'for' | 'case' | 'name' | null = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart: number | null = null;
  let afterPipe = false;
  let dir = cwd;
  let words: string[] = [];
  let redirects: Segment['redirects'] = [];

  const atCommandStart = (): boolean => words.length === 0 && redirects.length === 0;

  const close = (next: string | null): void => {
    if (atCommandStart()) return;
    const commandWords = stripAssignments(words);
    segments.push({ words: commandWords, redirects, cwd: dir, exits: [{ op: next, following: segments.length + 1 }] });
    const apart = afterPipe || isPipe(next) || next === '&';
    if (!apart) dir = dirAfter(commandWords, dir, pushed, home);
    words = [];
    redirects = [];
  };

  const readWord = (w: string): void => {
    if (casePatterns) {
      if (w === 'esac') {
        caseDepth--;
        casePatterns = false;
      }
    } else if (header === 'case') {
      if (w === 'in') {
        header = null;
        casePatterns = true;
      }
    } else if (header === 'name') {
      header = null;
    } else if (header === 'for') {
      // the loop's variable and list are not commands
    } else if (!atCommandStart()) {
      words.push(w);
    } else if (w === 'for' || w === 'select') {
      header = 'for';
    } else if (w === 'case') {
      header = 'case';
      caseDepth++;
    } else if (w === 'esac') {
      caseDepth = Math.max(0, caseDepth - 1);
    } else if (w === 'function') {
      header = 'name';
    } else if (w === '{') {
      groups.push({ dir: null, start: segments.length });
    } else if (w === '}') {
      const group = groups.pop();
      if (group !== undefined) closedGroupStart = group.start;
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    }
  };

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.kind === 'word') readWord(token.value);
    else if (token.kind === 'redirect') redirects.push({ op: token.op, target: token.target });
    else if (casePatterns || header === 'case') {
      // a case pattern list: `a|b)`, `(a)`
      if (casePatterns && token.value === ')') casePatterns = false;
    } else if (token.value === '(' && isOp(tokens[k + 1], ')')) {
      // `f()`: a function definition; its body follows
      words = [];
      k++;
    } else {
      if (header === 'for') header = null;
      close(token.value);
      if (closedGroupStart !== null && token.value !== ')') {
        for (const inner of segments.slice(closedGroupStart)) inner.exits.push({ op: token.value, following: segments.length });
        closedGroupStart = null;
      }
      afterPipe = isPipe(token.value);
      if (token.value === '(') groups.push({ dir, start: segments.length });
      if (token.value === ')') {
        const group = groups.pop();
        if (group !== undefined) {
          dir = group.dir ?? dir;
          closedGroupStart = group.start;
        }
      }
      if (token.value === ';;' && caseDepth > 0) casePatterns = true;
    }
  }
  close(null);
  return segments;
}

/** The part for a segment, followed by the parts of the script it runs (`sh -c`, `eval`). */
function toParts(segment: Segment, segments: Segment[], home: string, depth: number): CommandPart[] {
  const { words, cwd } = unwrap(segment.words, segment.cwd, home);
  const program = words[0] ?? null;
  const name = program === null ? null : path.posix.basename(program);
  const args = words.slice(1);
  const part: CommandPart = {
    words,
    program,
    cwd,
    writeTargets: [...redirectWrites(segment), ...operandWrites(name, args)].map((p) => resolvePath(p, cwd, home)),
    hosts: args.flatMap(hostOf),
    git: name === 'git' ? readGit(args, cwd, home) : null,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === '||' && isTrue(segments[e.following]?.words ?? [])),
  };
  const script = scriptOf(name, args);
  if (script === null) return [part];
  if (DYNAMIC_SCRIPT.test(script)) throw new Unreadable(`${name} runs a script that is not literal`);
  if (depth >= MAX_NESTED_DEPTH) throw new Unreadable(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const nested = readScript(script, cwd, home, depth + 1);
  return [part, ...nested.map((p) => ({ ...p, pipedOut: p.pipedOut || part.pipedOut, orTrue: p.orTrue || part.orTrue }))];
}

function isOp(token: Token | undefined, value: string): boolean {
  return token?.kind === 'op' && token.value === value;
}

function isPipe(op: string | null): boolean {
  return op !== null && PIPES.includes(op);
}

function isTrue(words: string[]): boolean {
  return words.length === 1 && (words[0] === 'true' || words[0] === ':');
}

function nameOf(word: string | undefined): string {
  return word === undefined ? '' : path.posix.basename(word);
}

/** The words of the program a wrapper runs, recursively, and the directory it runs in. */
function unwrap(words: string[], cwd: string, home: string): { words: string[]; cwd: string } {
  let dir = cwd;
  let rest = words;
  for (let spec = WRAPPERS.get(nameOf(rest[0])); spec !== undefined; spec = WRAPPERS.get(nameOf(rest[0]))) {
    let split: string[] = [];
    let i = 1;
    for (; i < rest.length; i++) {
      const w = rest[i];
      if (w === '--') {
        i++;
        break;
      }
      if (spec.assignments === true && ASSIGNMENT.test(w)) continue;
      if (!w.startsWith('-') || w === '-') break;
      const long = w.startsWith('--');
      const eq = long ? w.indexOf('=') : -1;
      // In a short cluster (`-Eu`), the first letter that takes a value takes the rest of it, or the next word.
      const at = long ? 0 : [...w.slice(1)].findIndex((l) => spec.values.includes(`-${l}`)) + 1;
      if (at === 0 && !long) continue;
      const flag = long ? (eq === -1 ? w : w.slice(0, eq)) : `-${w[at]}`;
      if (!spec.values.includes(flag)) continue;
      let value: string | undefined;
      if (eq !== -1) value = w.slice(eq + 1);
      else if (!long && w.length > at + 1) value = w.slice(at + 1);
      else value = rest[++i];
      if (value === undefined) break;
      if (spec.dir?.includes(flag)) dir = resolvePath(value, dir, home);
      if (spec.split?.includes(flag)) split = splitWords(value);
    }
    const next = [...split, ...rest.slice(i + (spec.operands ?? 0))];
    if (next.length === 0) break;
    rest = next;
  }
  return { words: rest, cwd: dir };
}

/** The words of an `env -S` string. */
function splitWords(value: string): string[] {
  const result = tokenize(value);
  if ('unreadable' in result) throw new Unreadable(result.reason);
  return result.tokens.flatMap((t) => (t.kind === 'word' ? [t.value] : []));
}

/** The script a part runs: the `-c` script of a shell, or the joined words of `eval`; else null. */
function scriptOf(name: string | null, args: string[]): string | null {
  if (name === 'eval') return args.length > 0 ? args.join(' ') : null;
  if (name === null || !SHELLS.has(name)) return null;
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a.startsWith('-') || a.startsWith('+')) {
      command ||= COMMAND_STRING_FLAG.test(a);
      // like bash, each value-taking letter of a cluster (`-eo pipefail`, `-oc pipefail 'x'`) takes the next word
      if (SHORT_OPTION_CLUSTER.test(a)) i += [...a.slice(1)].filter((l) => SHELL_VALUE_OPTIONS.has(`-${l}`)).length;
    }
    else return command ? a : null;
  }
  return null;
}

function stripAssignments(words: string[]): string[] {
  const first = words.findIndex((w) => !ASSIGNMENT.test(w));
  return first === -1 ? [] : words.slice(first);
}

function expandTilde(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return home + p.slice(1);
  return p;
}

function resolvePath(p: string, cwd: string, home: string): string {
  return path.resolve(cwd, expandTilde(p, home));
}

/** The shell's directory after a command: moved by `cd`, `pushd` and `popd` (also after `command`, `builtin`, `time`). */
function dirAfter(words: string[], dir: string, pushed: string[], home: string): string {
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [verb, ...args] = words.slice(p);
  if (verb === 'cd') return cdTarget(args, dir, home);
  if (verb === 'pushd' && args.length > 0) {
    pushed.push(dir);
    return cdTarget(args, dir, home);
  }
  if (verb === 'popd') return pushed.pop() ?? dir;
  return dir;
}

/** The directory after `cd <args>`: home with no argument, unchanged for `cd -` or several arguments. */
function cdTarget(args: string[], dir: string, home: string): string {
  if (args.length === 0) return home;
  if (args.length > 1 || args[0] === '-') return dir;
  return resolvePath(args[0], dir, home);
}

function redirectWrites(segment: Segment): string[] {
  return segment.redirects
    .filter((r) => OUTPUT_REDIRECT.test(r.op) && !FD_DUPLICATION.test(r.target))
    .map((r) => (r.target.startsWith('&') ? r.target.slice(1) : r.target));
}

/** Non-flag operands; everything after `--` is an operand. */
function operands(args: string[]): string[] {
  const end = args.indexOf('--');
  const before = end === -1 ? args : args.slice(0, end);
  const after = end === -1 ? [] : args.slice(end + 1);
  return [...before.filter((a) => !a.startsWith('-')), ...after];
}

function operandWrites(name: string | null, args: string[]): string[] {
  if (name === 'rm' || name === 'mv') return operands(args);
  if (name === 'cp') {
    const t = args.indexOf('-t');
    if (t !== -1 && t + 1 < args.length) return [args[t + 1]];
    return operands(args).slice(-1);
  }
  return [];
}

function hostOf(arg: string): string[] {
  const value = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
  const url = URL_AUTHORITY.exec(value);
  let host: string | undefined;
  if (url) host = url[1].slice(url[1].lastIndexOf('@') + 1).replace(/:[0-9]*$/, '');
  else host = USER_AT_HOST.exec(value)?.[1] ?? (!value.startsWith('-') && BARE_HOST.test(value) ? value : undefined);
  return host ? [host.toLowerCase()] : [];
}

function readGit(args: string[], cwd: string, home: string): CommandPart['git'] {
  let dir = cwd;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C' && i + 1 < args.length) dir = resolvePath(args[i + 1], dir, home);
    i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1;
  }
  if (i >= args.length) return null;
  return { subcommand: args[i], args: args.slice(i + 1), dir };
}
