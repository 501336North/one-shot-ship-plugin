/**
 * Command reader for the tool gate.
 *
 * Turns a tokenized shell command into one set of facts per part: the program and its words,
 * the directory it runs in (after `cd`, `( … )` and `git -C`), the files it writes or removes,
 * the hosts it talks to, and whether its result is hidden by a pipe or `|| true`.
 * Pure: it never touches the filesystem.
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

interface Segment {
  words: string[];
  redirects: { op: string; target: string }[];
  cwd: string;
  /** The operator that ends this segment, or null at the end of the command. */
  next: string | null;
}

const OUTPUT_REDIRECT = /^[0-9]*(?:>|>>|>\|)$|^&>>?$/;
/** `&1`, `&2-`, `&-`: duplicates or closes another output; not a file. */
const FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
const USER_AT_HOST = /^[^@/\s]+@([^:/\s]+)/;
const BARE_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
/** git global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

export function readCommand(cmd: string, cwd: string, home: string): CommandFacts | { unreadable: true; reason: string } {
  const result = tokenize(cmd);
  if ('unreadable' in result) return result;
  const segments = split(result.tokens, cwd, home);
  return { parts: segments.map((segment, i) => toPart(segment, segments[i + 1], home)) };
}

/** Splits tokens into segments on control operators, tracking the directory through `cd` and `( … )`. */
function split(tokens: Token[], cwd: string, home: string): Segment[] {
  const segments: Segment[] = [];
  const outer: string[] = [];
  let dir = cwd;
  let words: string[] = [];
  let redirects: Segment['redirects'] = [];

  const close = (next: string | null): void => {
    if (words.length === 0 && redirects.length === 0) return;
    const commandWords = stripAssignments(words);
    segments.push({ words: commandWords, redirects, cwd: dir, next });
    if (commandWords[0] === 'cd') dir = cdTarget(commandWords.slice(1), dir, home);
    words = [];
    redirects = [];
  };

  for (const token of tokens) {
    if (token.kind === 'word') words.push(token.value);
    else if (token.kind === 'redirect') redirects.push({ op: token.op, target: token.target });
    else {
      close(token.value);
      if (token.value === '(') outer.push(dir);
      if (token.value === ')') dir = outer.pop() ?? dir;
    }
  }
  close(null);
  return segments;
}

function toPart(segment: Segment, following: Segment | undefined, home: string): CommandPart {
  const { words, cwd, next } = segment;
  const program = words[0] ?? null;
  const name = program === null ? null : path.posix.basename(program);
  const args = words.slice(1);
  const nextWords = following?.words ?? [];
  return {
    words,
    program,
    cwd,
    writeTargets: [...redirectWrites(segment), ...operandWrites(name, args)].map((p) => resolvePath(p, cwd, home)),
    hosts: args.flatMap(hostOf),
    git: name === 'git' ? readGit(args, cwd, home) : null,
    pipedOut: next === '|' || next === '|&',
    orTrue: next === '||' && nextWords.length === 1 && (nextWords[0] === 'true' || nextWords[0] === ':'),
  };
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
