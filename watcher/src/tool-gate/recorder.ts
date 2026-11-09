/**
 * Post-call recorder for the tool gate (US-005). After a Bash call, a command with a part
 * matching `testCommandPatterns` is a test run: PostToolUse is green, PostToolUseFailure with
 * "Exit code N" is red (and starts a new cycle), and a hidden result (piped, `|| true` / `|| :`,
 * interrupted, or any other failure) is unknown and leaves the cycle unchanged. It never runs
 * anything itself; the state store is its only collaborator.
 */

import { readCommand } from './command-reader.js';
import { matchCommand } from './patterns.js';
import type { GateSettings } from './rule-file.js';
import type { CycleRecord, StateStore } from './state-store.js';

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
}

const EXIT_CODE = /^Exit code \d+/;

export function recordTestRun(call: PostCall, ctx: RecordContext): void {
  const facts = readCommand(call.command, call.cwd, ctx.home);
  if ('unreadable' in facts) return;
  const testParts = facts.parts.filter((part) =>
    ctx.settings.testCommandPatterns.some((pattern) => matchCommand(pattern, part.words)),
  );
  if (testParts.length === 0) return;

  const hidden = call.isInterrupt === true || testParts.some((part) => part.pipedOut || part.orTrue);
  const result = hidden
    ? 'unknown'
    : call.hookEvent === 'PostToolUse'
      ? 'green'
      : EXIT_CODE.test(call.error ?? '')
        ? 'red'
        : 'unknown';
  ctx.store.appendEvent({ ts: ctx.ts, tool: 'Bash', kind: 'test-run', command: call.command, result });
  if (result === 'unknown') return;

  const previous = ctx.store.readCycle();
  const thisBuild: Pick<CycleRecord, 'files' | 'adoptedCommand'> =
    previous !== null && previous.startedAt === ctx.buildStartedAt ? previous : { files: [], adoptedCommand: null };
  ctx.store.writeCycle({
    startedAt: ctx.buildStartedAt,
    lastResult: result,
    files: result === 'red' ? [] : thisBuild.files,
    adoptedCommand: thisBuild.adoptedCommand,
  });
}
