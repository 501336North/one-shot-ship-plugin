/**
 * Post-call recorder for the tool gate (US-005). After a Bash call, a command with a part
 * matching `testCommandPatterns` is a test run: PostToolUse is green, PostToolUseFailure with
 * "Exit code N" is red (and starts a new cycle) when a test part is the last part that ran
 * (parts are in run order, nested `-c` parts included), and a hidden result (piped,
 * `|| true` / `|| :`, interrupted, a command after the test, or any other failure) is unknown
 * and leaves the cycle unchanged. During a build, an unlisted test-like command that fails
 * that way (last, unhidden) is adopted as this build's runner (`runner-adopted`, AC-004.9) and
 * from then on counts like a listed one. It never runs
 * anything itself; the state store is its only collaborator.
 */

import path from 'node:path';
import { readCommand, type CommandPart } from './command-reader.js';
import { matchCommand, matchPath } from './patterns.js';
import type { GateSettings } from './rule-file.js';
import type { CycleRecord, StateStore } from './state-store.js';
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

/** A word, split on non-alphanumerics, is a test word, or a word names a test file. */
function isTestLike(part: CommandPart, settings: GateSettings, root: string, home: string): boolean {
  return part.words.some(
    (word) =>
      word
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((piece) => TEST_WORDS.has(piece)) ||
      settings.testFilePatterns.some((glob) => matchPath(glob, path.resolve(part.cwd, word), { home, root })),
  );
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
    // Runner adoption (AC-004.9): an unlisted, test-like command that failed last, unhidden, in a build.
    if (
      ctx.currentCommand !== BUILD_COMMAND ||
      !failedWithExitCode ||
      call.isInterrupt === true ||
      last === undefined ||
      facts.parts.some((part) => part.pipedOut || part.orTrue) ||
      !isTestLike(last, ctx.settings, call.cwd, ctx.home)
    ) {
      return;
    }
    adoptedCommand = last.words.join(' ');
    testParts = [last];
    ctx.store.appendEvent({ ts: ctx.ts, tool: 'Bash', kind: 'runner-adopted', command: call.command, result: 'red' });
  }

  const hidden = call.isInterrupt === true || testParts.some((part) => part.pipedOut || part.orTrue);
  const result = hidden
    ? 'unknown'
    : call.hookEvent === 'PostToolUse'
      ? 'green'
      : failedWithExitCode && last !== undefined && testParts.includes(last)
        ? 'red'
        : 'unknown';
  ctx.store.appendEvent({ ts: ctx.ts, tool: 'Bash', kind: 'test-run', command: call.command, result });
  if (result === 'unknown') return;

  ctx.store.writeCycle({
    startedAt: ctx.buildStartedAt,
    lastResult: result,
    files: result === 'red' ? [] : thisBuild.files,
    adoptedCommand,
  });
}
