/**
 * @behavior The tool gate remembers this build's last test result (red or green) and the
 *   source files edited since, in `.oss/tool-gates/cycle.json`, and logs every refusal and
 *   test run as one line in `.oss/tool-gates/events.ndjson`.
 * @business-rule A missing or damaged record means "no test run yet", so source edits stay
 *   refused until a test goes red. The gate never writes its state outside the repo, even
 *   when `.oss` or `.oss/tool-gates` is a symlink. The benchmark (R-267) reads one JSON line
 *   per event with time, tool, kind, rule id or test command, and result (AC-011.1).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStateStore, type CycleRecord, type GateEvent } from '../../src/tool-gate/state-store.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-state-store-')));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const redCycle: CycleRecord = {
  startedAt: '2026-11-09T20:00:00.000Z',
  lastResult: 'red',
  files: [],
  adoptedCommand: null,
};

describe('tool-gate state store', () => {
  it('should write cycle.json atomically (temp + rename) and read it back', () => {
    const repo = tempDir();
    const store = fileStateStore(repo);
    store.writeCycle(redCycle);
    const stateDir = path.join(repo, '.oss', 'tool-gates');
    const firstInode = fs.statSync(path.join(stateDir, 'cycle.json')).ino;

    const greenCycle: CycleRecord = {
      startedAt: '2026-11-09T20:00:00.000Z',
      lastResult: 'green',
      files: ['/repo/src/a.ts'],
      adoptedCommand: './run-tests.sh',
    };
    store.writeCycle(greenCycle);

    expect(store.readCycle()).toEqual(greenCycle);
    // Replaced by a rename (a new file), never rewritten in place, and no temp file left over.
    expect(fs.statSync(path.join(stateDir, 'cycle.json')).ino).not.toBe(firstInode);
    expect(fs.readdirSync(stateDir)).toEqual(['cycle.json']);
  });

  it('should treat a missing or corrupt cycle.json as no run yet', () => {
    const repo = tempDir();
    const store = fileStateStore(repo);
    expect(store.readCycle()).toBeNull();

    const stateDir = path.join(repo, '.oss', 'tool-gates');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'cycle.json'), '{"lastResult": "red", ');
    expect(store.readCycle()).toBeNull();

    fs.writeFileSync(path.join(stateDir, 'cycle.json'), JSON.stringify({ lastResult: 'purple' }));
    expect(store.readCycle()).toBeNull();
  });

  it('should append one JSON line per event with ts, tool, kind, rule|command, result', () => {
    const repo = tempDir();
    const store = fileStateStore(repo);
    const refusal: GateEvent = {
      ts: '2026-11-09T20:01:00.000Z',
      tool: 'Bash',
      kind: 'refusal',
      rule: 'force-push',
      result: 'refused',
    };
    const testRun: GateEvent = {
      ts: '2026-11-09T20:02:00.000Z',
      tool: 'Bash',
      kind: 'test-run',
      command: 'npm test',
      result: 'red',
    };
    store.appendEvent(refusal);
    store.appendEvent(testRun);

    const text = fs.readFileSync(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([refusal, testRun]);
  });

  it('should create .oss/tool-gates/ when missing, and refuse to write through a symlinked .oss or .oss/tool-gates', () => {
    const event: GateEvent = {
      ts: '2026-11-09T20:03:00.000Z',
      tool: 'Edit',
      kind: 'refusal',
      rule: 'red-cycle',
      result: 'refused',
    };

    // Missing folder: created on first write.
    const plain = tempDir();
    fileStateStore(plain).appendEvent(event);
    expect(fs.existsSync(path.join(plain, '.oss', 'tool-gates', 'events.ndjson'))).toBe(true);

    // `.oss` is a symlink to a folder outside the repo.
    const outsideOss = tempDir();
    const ossLinked = tempDir();
    fs.symlinkSync(outsideOss, path.join(ossLinked, '.oss'));
    const ossStore = fileStateStore(ossLinked);
    expect(() => ossStore.writeCycle(redCycle)).toThrow();
    expect(() => ossStore.appendEvent(event)).toThrow();

    // `.oss/tool-gates` is a symlink to a folder outside the repo.
    const outsideState = tempDir();
    const stateLinked = tempDir();
    fs.mkdirSync(path.join(stateLinked, '.oss'));
    fs.symlinkSync(outsideState, path.join(stateLinked, '.oss', 'tool-gates'));
    const stateStore = fileStateStore(stateLinked);
    expect(() => stateStore.writeCycle(redCycle)).toThrow();
    expect(() => stateStore.appendEvent(event)).toThrow();

    // Nothing landed outside the repo.
    expect(fs.readdirSync(outsideOss)).toEqual([]);
    expect(fs.readdirSync(outsideState)).toEqual([]);
  });

  it('should refuse to append an event through a symlinked events.ndjson', () => {
    const repo = tempDir();
    const outsideFile = path.join(tempDir(), 'victim.txt');
    fs.writeFileSync(outsideFile, 'untouched\n');
    const stateDir = path.join(repo, '.oss', 'tool-gates');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.symlinkSync(outsideFile, path.join(stateDir, 'events.ndjson'));

    const event: GateEvent = {
      ts: '2026-11-09T20:04:00.000Z',
      tool: 'Bash',
      kind: 'test-run',
      command: 'npm test',
      result: 'green',
    };
    expect(() => fileStateStore(repo).appendEvent(event)).toThrow();
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('untouched\n');
  });

  it('should refuse to write cycle.json through a planted symlink at the temp path', () => {
    const repo = tempDir();
    const outsideFile = path.join(tempDir(), 'victim.txt');
    fs.writeFileSync(outsideFile, 'untouched\n');
    const stateDir = path.join(repo, '.oss', 'tool-gates');
    fs.mkdirSync(stateDir, { recursive: true });
    // The store writes its temp file next to cycle.json, named after this process.
    fs.symlinkSync(outsideFile, path.join(stateDir, `cycle.json.${process.pid}.tmp`));

    try {
      fileStateStore(repo).writeCycle(redCycle);
    } catch {
      // Refusing is fine; writing through the link is not.
    }
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('untouched\n');
  });

  it('should treat a symlinked .oss/tool-gates or cycle.json as no run yet when reading', () => {
    const recorded = JSON.stringify(redCycle);

    // `.oss/tool-gates` links to an outside folder holding a red cycle.
    const outsideState = tempDir();
    fs.writeFileSync(path.join(outsideState, 'cycle.json'), recorded);
    const dirLinked = tempDir();
    fs.mkdirSync(path.join(dirLinked, '.oss'));
    fs.symlinkSync(outsideState, path.join(dirLinked, '.oss', 'tool-gates'));
    expect(fileStateStore(dirLinked).readCycle()).toBeNull();

    // `cycle.json` itself links to an outside file holding a red cycle.
    const outsideFile = path.join(tempDir(), 'fake-cycle.json');
    fs.writeFileSync(outsideFile, recorded);
    const fileLinked = tempDir();
    fs.mkdirSync(path.join(fileLinked, '.oss', 'tool-gates'), { recursive: true });
    fs.symlinkSync(outsideFile, path.join(fileLinked, '.oss', 'tool-gates', 'cycle.json'));
    expect(fileStateStore(fileLinked).readCycle()).toBeNull();
  });
});
