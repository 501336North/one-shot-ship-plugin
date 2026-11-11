/**
 * State store for the tool gate: this build's RED/GREEN cycle (`cycle.json`, written
 * atomically) and the event log (`events.ndjson`, one JSON line per event) under
 * `<repoRoot>/.oss/tool-gates/`. A collaborator, mocked in the recorder and RED-rule tests.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readRegularFile } from './regular-file.js';
import type { RuleId } from './rules/refusal.js';

export type TestResult = 'red' | 'green';

export interface CycleRecord {
  /** The build's `currentCommandStartedAt` this cycle was made under (null when absent). */
  startedAt: string | null;
  lastResult: TestResult;
  /** Source files edited since the last red run. */
  files: string[];
  /** The unlisted test command adopted for this build, if any. */
  adoptedCommand: string | null;
}

export type EventKind =
  | 'refusal'
  | 'test-run'
  | 'runner-adopted'
  | 'unreadable'
  | 'gate-error'
  | 'rule-file-rejected';

export interface GateEvent {
  ts: string;
  tool: string;
  kind: EventKind;
  rule?: RuleId;
  /** The program's file name (`git`, `npm`), never the command text, which can hold secrets. */
  program?: string;
  result: 'red' | 'green' | 'unknown' | 'refused' | 'allowed';
}

/**
 * What a program name may look like to be logged: a plain file name of at most 64 characters.
 * A code constant (filesystem syntax), not a rule value: anything else might be a secret.
 */
const LOGGABLE_PROGRAM = /^[A-Za-z0-9._+-]{1,64}$/;

/** `{ program }` with the program's file name when it is loggable, else nothing. */
export function programField(program: string | null | undefined): { program?: string } {
  const name = path.basename(program ?? '');
  return LOGGABLE_PROGRAM.test(name) ? { program: name } : {};
}

/** Largest cycle.json read (a read limit, not a rule value); a bigger one is no cycle. */
const MAX_CYCLE_BYTES = 1024 * 1024;

export interface StateStore {
  /** The current cycle, or null for "no run yet" (missing or corrupt file). */
  readCycle(): CycleRecord | null;
  writeCycle(cycle: CycleRecord): void;
  appendEvent(event: GateEvent): void;
}

function isCycleRecord(value: unknown): value is CycleRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.startedAt === null || typeof v.startedAt === 'string') &&
    (v.lastResult === 'red' || v.lastResult === 'green') &&
    Array.isArray(v.files) &&
    v.files.every((f) => typeof f === 'string') &&
    (v.adoptedCommand === null || typeof v.adoptedCommand === 'string')
  );
}

export function fileStateStore(repoRoot: string): StateStore {
  const ossDir = path.join(repoRoot, '.oss');
  const stateDir = path.join(ossDir, 'tool-gates');
  const cycleFile = path.join(stateDir, 'cycle.json');
  const eventsFile = path.join(stateDir, 'events.ndjson');

  const { O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY } = fs.constants;

  /** Throws when `.oss` or `.oss/tool-gates` is a symlink. */
  function refuseSymlinkedDirs(): void {
    for (const dir of [ossDir, stateDir]) {
      if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`tool-gate state: ${dir} is a symlink`);
      }
    }
  }

  /** Creates the state folder, refusing a symlinked `.oss` / `.oss/tool-gates` or one outside the repo. */
  function safeStateDir(): void {
    refuseSymlinkedDirs();
    fs.mkdirSync(stateDir, { recursive: true });
    const real = fs.realpathSync(stateDir);
    if (!real.startsWith(fs.realpathSync(repoRoot) + path.sep)) {
      throw new Error(`tool-gate state: ${stateDir} resolves outside the repo`);
    }
  }

  return {
    readCycle() {
      try {
        refuseSymlinkedDirs();
        // Never blocks: a named pipe (or a symlink) here is no cycle, not a stalled gate.
        const read = readRegularFile(cycleFile, MAX_CYCLE_BYTES, true);
        if (typeof read !== 'object') return null;
        const parsed: unknown = JSON.parse(read.text);
        return isCycleRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    writeCycle(cycle) {
      safeStateDir();
      const temp = `${cycleFile}.${process.pid}.tmp`;
      const fd = fs.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW);
      try {
        fs.writeFileSync(fd, JSON.stringify(cycle));
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, cycleFile);
    },
    appendEvent(event) {
      safeStateDir();
      const fd = fs.openSync(eventsFile, O_APPEND | O_CREAT | O_WRONLY | O_NOFOLLOW);
      try {
        fs.writeFileSync(fd, JSON.stringify(event) + '\n');
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}
