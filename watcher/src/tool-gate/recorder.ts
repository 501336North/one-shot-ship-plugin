/**
 * Post-call recorder for the tool gate (US-005). After a Bash call, a command with a part
 * matching `testCommandPatterns` is a test run: PostToolUse is green, PostToolUseFailure with
 * "Exit code N" is red (and starts a new cycle) when a test part is the last part that ran
 * (parts are in run order, nested `-c` parts included), and a hidden result (piped,
 * `|| true` / `|| :`, interrupted, a command after the test, or any other failure) is unknown
 * and leaves the cycle unchanged. During a build, an unlisted test-like command that fails
 * that way (last, unhidden) is adopted as this build's runner (`runner-adopted`, AC-004.9) and
 * from then on counts like a listed one. It never runs anything itself; the state store is its
 * only collaborator.
 */

import path from 'node:path';
import { readCommand, type CommandPart } from './command-reader.js';
import { matchAnyPath, matchCommand } from './patterns.js';
import type { GateSettings } from './rule-file.js';
import { programField, type CycleRecord, type StateStore } from './state-store.js';
import { BUILD_COMMAND } from './workflow-state.js';

export interface PostCall {
  hookEvent: 'PostToolUse' | 'PostToolUseFailure';
  command: string;
  cwd: string;
  /** PostToolUseFailure's `error`, e.g. "Exit code 1…". */
  error?: string;
  /** PostToolUseFailure's `is_interrupt`. */
  isInterrupt?: boolean;
}

export interface RecordContext {
  settings: GateSettings;
  store: StateStore;
  home: string;
  /** The project root that test-file globs are anchored at (the command's `cwd` when absent). */
  root?: string;
  /** The event time, set by the caller. */
  ts: string;
  /** The current build's `currentCommandStartedAt` (null when absent). */
  buildStartedAt: string | null;
  /** The running `/oss:*` command's `currentCommand` (null when absent). */
  currentCommand: string | null;
}

const EXIT_CODE = /^Exit code \d+/;

/**
 * Plan decision 4: the words that make an unlisted command test-like. A code constant, not a
 * rule value: it is the fixed meaning of "contains test/spec/check" (AC-004.9), and a repo rule
 * file must not be able to widen what gets adopted.
 */
const TEST_WORDS = new Set(['test', 'tests', 'spec', 'specs', 'check', 'checks']);

/**
 * Programs never adopted, however they are worded: shell tests, searches, VCS and output tools
 * fail easily (`test -f missing`, `grep -r check src`, `git check-ignore x`), so adopting them
 * would hand out a red with no failing test. A code constant, not a rule value: it says what
 * each program is, and it can only narrow adoption.
 */
const NEVER_ADOPTED = new Set(['test', '[', '[[', 'grep', 'egrep', 'fgrep', 'rg', 'git', 'find', 'echo', 'printf', 'ls', 'cat']);

/** A word, split on non-alphanumerics, is a test word, or a word names a test file. */
function isTestLike(part: CommandPart, settings: GateSettings, root: string, home: string): boolean {
  return part.words.some(
    (word) =>
      word
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((piece) => TEST_WORDS.has(piece)) ||
      matchAnyPath(settings.testFilePatterns, path.resolve(part.cwd, word), { home, root }),
  );
}

/** The most of an adopted command kept in cycle.json, so a huge command can't bloat the state. */
const MAX_ADOPTED_LENGTH = 512;

/** The leading words that fit in MAX_ADOPTED_LENGTH: still a word-by-word prefix, so later runs match. */
function adoptedPattern(words: string[]): string {
  let kept = words[0] ?? '';
  for (const word of words.slice(1)) {
    if (kept.length + 1 + word.length > MAX_ADOPTED_LENGTH) break;
    kept = `${kept} ${word}`;
  }
  return kept.slice(0, MAX_ADOPTED_LENGTH);
}

/** Green on success; red only when a test part ran last and failed with an exit code; else unknown. */
function runResult(
  call: PostCall,
  testParts: CommandPart[],
  last: CommandPart | undefined,
  failedWithExitCode: boolean,
): 'green' | 'red' | 'unknown' {
  const hidden = call.isInterrupt === true || testParts.some((part) => part.pipedOut || part.orTrue);
  if (hidden) return 'unknown';
  if (call.hookEvent === 'PostToolUse') return 'green';
  return failedWithExitCode && last !== undefined && testParts.includes(last) ? 'red' : 'unknown';
}

export function recordTestRun(call: PostCall, ctx: RecordContext): void {
  const facts = readCommand(call.command, call.cwd, ctx.home);
  if ('unreadable' in facts) return;
  const previous = ctx.store.readCycle();
  const thisBuild: Pick<CycleRecord, 'files' | 'adoptedCommand'> =
    previous !== null && previous.startedAt === ctx.buildStartedAt ? previous : { files: [], adoptedCommand: null };
  const patterns =
    thisBuild.adoptedCommand === null
      ? ctx.settings.testCommandPatterns
      : [...ctx.settings.testCommandPatterns, thisBuild.adoptedCommand];
  let testParts = facts.parts.filter((part) => patterns.some((pattern) => matchCommand(pattern, part.words)));
  const last = facts.parts[facts.parts.length - 1];
  const failedWithExitCode = call.hookEvent === 'PostToolUseFailure' && EXIT_CODE.test(call.error ?? '');
  let adoptedCommand = thisBuild.adoptedCommand;

  if (testParts.length === 0) {
    // Runner adoption (AC-004.9): the build's first unlisted, test-like command that failed last, unhidden.
    if (
      ctx.currentCommand !== BUILD_COMMAND ||
      thisBuild.adoptedCommand !== null ||
      !failedWithExitCode ||
      call.isInterrupt === true ||
      last === undefined ||
      NEVER_ADOPTED.has(path.basename(last.program ?? '')) ||
      facts.parts.some((part) => part.pipedOut || part.orTrue) ||
      !isTestLike(last, ctx.settings, ctx.root ?? call.cwd, ctx.home)
    ) {
      return;
    }
    adoptedCommand = adoptedPattern(last.words);
    testParts = [last];
    ctx.store.appendEvent({ ts: ctx.ts, tool: 'Bash', kind: 'runner-adopted', ...programField(last.program), result: 'red' });
  }

  const result = runResult(call, testParts, last, failedWithExitCode);
  ctx.store.appendEvent({ ts: ctx.ts, tool: 'Bash', kind: 'test-run', ...programField(testParts[0]?.program), result });
  if (result === 'unknown') return;

  ctx.store.writeCycle({
    startedAt: ctx.buildStartedAt,
    lastResult: result,
    files: result === 'red' ? [] : thisBuild.files,
    adoptedCommand,
  });
}
