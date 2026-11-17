/**
 * @behavior The review-run check keeps its state (start snapshots, pending notices for the main agent,
 *   a ledger of each run's start and end, temporary files) per session under
 *   ~/.oss/gate-state/<session_id>/, never in the repo a review agent could change. Folders are private
 *   (0700), files 0600, never written or read through a symlink, never read when not a regular file (a
 *   FIFO cannot block the check), and only plain session and agent ids are used as names. A pending
 *   notice is handed out once, even when two hooks ask for it at the same moment; each is checked on its
 *   own, so a bad one never hides good ones, and a notice for a run the ledger does not know is counted
 *   as tampering, not delivered. Entries older than 2 days are swept.
 * @business-rule A review agent must not be able to hide its own changes by editing the check's
 *   records, and the main agent must hear about every void or unverified review run exactly once.
 * @user-story US-008 Any repo change during a review voids it (R-266, ADR-009)
 * @boundary run-store (watcher/src/gate-run/run-store.ts), real temp HOME folders and symlinks
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { REASONS } from '../../src/gate-run/messages.js';
import { recordMountBaseline } from '../../src/tool-gate/mounts.js';
import {
  isSafeId,
  sessionFolder,
  sessionState,
  writePrivateFile,
  readPrivateFile,
  takePrivateFile,
  takeNotices,
  storeNotice,
  sweepRunFolder,
  runRoot,
  mark,
  hasMark,
  clearMark,
} from '../../src/gate-run/run-store.js';

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-run-store-')));
  tempDirs.push(dir);
  return dir;
}

function mode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

describe('gate-run state under ~/.oss/gate-state (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('makes a private session folder under the run root', () => {
    const home = tempHome();

    const dir = sessionFolder(home, 'session-1');

    expect(dir).toBe(path.join(home, '.oss', 'gate-state', 'session-1'));
    expect(mode(dir)).toBe(0o700);
    expect(mode(runRoot(home))).toBe(0o700);
  });

  it.each([['../x'], ['a/b'], [''], ['a'.repeat(129)], ['x y']])('refuses an unsafe session id %j', (id) => {
    const home = tempHome();

    expect(isSafeId(id)).toBe(false);
    expect(() => sessionFolder(home, id)).toThrow();
    expect(fs.existsSync(path.join(home, '.oss', 'gate-state'))).toBe(false);
  });

  it('refuses a symlinked run root or session folder and writes nothing through it', () => {
    const home = tempHome();
    const elsewhere = tempHome();
    fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(home, '.oss', 'gate-state'));

    expect(() => sessionFolder(home, 's1')).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);

    const home2 = tempHome();
    fs.mkdirSync(runRoot(home2), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(runRoot(home2), 's2'));
    expect(() => sessionFolder(home2, 's2')).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('writes files 0600 and never through a symlink in their place', () => {
    const home = tempHome();
    const dir = sessionFolder(home, 's1');
    const target = path.join(tempHome(), 'target');
    fs.writeFileSync(target, 'keep\n');
    fs.symlinkSync(target, path.join(dir, 'a.snap.json'));

    expect(() => writePrivateFile(path.join(dir, 'a.snap.json'), 'x')).toThrow();
    expect(() => readPrivateFile(path.join(dir, 'a.snap.json'))).toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('keep\n');

    writePrivateFile(path.join(dir, 'b.snap.json'), 'hello');
    expect(mode(path.join(dir, 'b.snap.json'))).toBe(0o600);
    expect(readPrivateFile(path.join(dir, 'b.snap.json'))).toBe('hello');
    expect(readPrivateFile(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('hands a file out once: the second take finds nothing', () => {
    const home = tempHome();
    const file = path.join(sessionFolder(home, 's1'), 'a.notice.json');
    writePrivateFile(file, 'once');

    expect(takePrivateFile(file)).toBe('once');
    expect(takePrivateFile(file)).toBeNull();
    expect(fs.readdirSync(path.dirname(file))).toEqual([]);
  });

  it("keeps pending notices per session and hands out all of one session's notices once", () => {
    const home = tempHome();
    for (const [sid, aid] of [['s1', 'agent-a'], ['s1', 'agent-b'], ['s2', 'agent-c']]) mark(home, sid, aid, 'started');
    storeNotice(home, 's1', 'agent-a', { kind: 'void', files: ['src/a.ts'], total: 1 });
    storeNotice(home, 's1', 'agent-b', { kind: 'unverified', reason: 'the check ran out of time' });
    storeNotice(home, 's2', 'agent-c', { kind: 'void', files: ['x'], total: 1 });

    const taken = takeNotices(home, 's1');

    expect(taken.notices).toEqual(
      expect.arrayContaining([
        { kind: 'void', files: ['src/a.ts'], total: 1 },
        { kind: 'unverified', reason: 'the check ran out of time' },
      ]),
    );
    expect(taken.notices).toHaveLength(2);
    expect(taken).toMatchObject({ unreadable: 0, unknown: 0 });
    expect(takeNotices(home, 's1').notices).toEqual([]);
    expect(takeNotices(home, 's2').notices).toHaveLength(1);
    expect(mode(path.join(runRoot(home), 's1'))).toBe(0o700);
  });

  it('keeps two notices for one run (neither overwrites the other) and takes them by agent id, once', () => {
    const home = tempHome();
    mark(home, 's1', 'agent-a', 'started');
    storeNotice(home, 's1', 'agent-a', { kind: 'void', files: ['src/a.ts'], total: 1 });
    storeNotice(home, 's1', 'agent-a', { kind: 'unverified', reason: REASONS.timeout });
    mark(home, 's1', 'agent-ab', 'started');
    storeNotice(home, 's1', 'agent-ab', { kind: 'unverified', reason: REASONS.checkFailed });

    expect(takeNotices(home, 's1', 'agent-a').notices).toHaveLength(2);
    expect(takeNotices(home, 's1', 'agent-a').notices).toEqual([]);
    expect(takeNotices(home, 's1', 'agent-ab').notices).toEqual([{ kind: 'unverified', reason: REASONS.checkFailed }]);
  });

  it('finds nothing (and makes nothing) for a session with no folder or an unsafe id', () => {
    const home = tempHome();

    expect(takeNotices(home, 'none').notices).toEqual([]);
    expect(takeNotices(home, '../x').notices).toEqual([]);
    expect(takeNotices(home, 's1', '../x').notices).toEqual([]);
    expect(fs.existsSync(runRoot(home))).toBe(false);
  });

  it('counts a notice for a run the ledger does not know as tampering and never delivers it', () => {
    const home = tempHome();
    const dir = sessionFolder(home, 's1');
    writePrivateFile(path.join(dir, 'planted.1.notice.json'), JSON.stringify({ kind: 'void', files: ['x'], total: 1 }));
    mark(home, 's1', 'agent-a', 'done');
    storeNotice(home, 's1', 'agent-a', { kind: 'void', files: ['real.ts'], total: 1 });

    const taken = takeNotices(home, 's1');

    expect(taken).toEqual({ notices: [{ kind: 'void', files: ['real.ts'], total: 1 }], unreadable: 0, unknown: 1 });
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.notice.json'))).toEqual([]);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an unknown kind', JSON.stringify({ kind: 'fine' })],
    ['files that are not strings', JSON.stringify({ kind: 'void', files: [1], total: 1 })],
    ['a missing total', JSON.stringify({ kind: 'void', files: ['a'] })],
    ['a reason that is not text', JSON.stringify({ kind: 'unverified', reason: 7 })],
  ])('counts a notice with %s as unreadable and still hands out the good ones', (_label, text) => {
    const home = tempHome();
    mark(home, 's1', 'agent-a', 'started');
    writePrivateFile(path.join(sessionFolder(home, 's1'), 'agent-a.1.notice.json'), text);
    storeNotice(home, 's1', 'agent-a', { kind: 'unverified', reason: REASONS.notARepo });

    expect(takeNotices(home, 's1')).toEqual({ notices: [{ kind: 'unverified', reason: REASONS.notARepo }], unreadable: 1, unknown: 0 });
  });

  it('caps what a notice can carry: 200 paths of at most 512 characters; a reason only from the check\'s own (else the generic one)', () => {
    const home = tempHome();
    mark(home, 's1', 'agent-a', 'started');
    const files = Array.from({ length: 300 }, (_, i) => `${'p'.repeat(600)}${i}`);
    writePrivateFile(
      path.join(sessionFolder(home, 's1'), 'agent-a.1.notice.json'),
      JSON.stringify({ kind: 'void', files, total: 300 }),
    );
    writePrivateFile(
      path.join(sessionFolder(home, 's1'), 'agent-a.2.notice.json'),
      JSON.stringify({ kind: 'unverified', reason: 'r'.repeat(500) }),
    );

    const { notices } = takeNotices(home, 's1');
    const voided = notices.find((n) => n.kind === 'void');
    const unverified = notices.find((n) => n.kind === 'unverified');

    expect(voided?.kind === 'void' && voided.files.length).toBe(200);
    expect(voided?.kind === 'void' && Math.max(...voided.files.map((f) => f.length))).toBe(512);
    expect(voided?.kind === 'void' && voided.total).toBe(300);
    expect(unverified?.kind === 'unverified' && unverified.reason).toBe(REASONS.checkFailed);
  });

  it('never reads a FIFO in place of a notice or state file (no hang): unreadable', () => {
    const home = tempHome();
    mark(home, 's1', 'agent-a', 'started');
    const fifo = path.join(sessionFolder(home, 's1'), 'agent-a.1.notice.json');
    execFileSync('mkfifo', [fifo]);

    expect(takeNotices(home, 's1')).toEqual({ notices: [], unreadable: 1, unknown: 0 });

    const other = path.join(sessionFolder(home, 's1'), 'agent-a.snap.json');
    execFileSync('mkfifo', [other]);
    expect(() => readPrivateFile(other)).toThrow();
  });

  it('keeps a ledger of marks per run: set, found, cleared; only plain ids', () => {
    const home = tempHome();

    mark(home, 's1', 'agent-a', 'started');

    expect(hasMark(home, 's1', 'agent-a', 'started')).toBe(true);
    expect(hasMark(home, 's1', 'agent-a', 'done')).toBe(false);
    clearMark(home, 's1', 'agent-a', 'started');
    expect(hasMark(home, 's1', 'agent-a', 'started')).toBe(false);
    expect(() => mark(home, 's1', '../x', 'done')).toThrow();
    expect(hasMark(home, '../s', 'agent-a', 'done')).toBe(false);
  });

  it("tells a missing, usable or unusable (symlinked) session folder apart", () => {
    const home = tempHome();
    expect(sessionState(home, 's1')).toBe('missing');
    sessionFolder(home, 's1');
    expect(sessionState(home, 's1')).toBe('ok');
    fs.symlinkSync(tempHome(), path.join(runRoot(home), 's2'));
    expect(sessionState(home, 's2')).toBe('unusable');
  });

  it('sweeps files and session folders older than 2 days, and keeps newer ones', () => {
    const home = tempHome();
    const oldSession = sessionFolder(home, 'old-session');
    writePrivateFile(path.join(oldSession, 'a.snap.json'), 'x');
    const liveSession = sessionFolder(home, 'live-session');
    const oldFile = path.join(liveSession, 'stale.index');
    const newFile = path.join(liveSession, 'b.snap.json');
    writePrivateFile(oldFile, 'x');
    writePrivateFile(newFile, 'x');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(oldSession, 'a.snap.json'), threeDaysAgo, threeDaysAgo);
    fs.utimesSync(oldSession, threeDaysAgo, threeDaysAgo);
    fs.utimesSync(oldFile, threeDaysAgo, threeDaysAgo);

    sweepRunFolder(home, Date.now());

    expect(fs.existsSync(oldSession)).toBe(false);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });
});

/**
 * Round 14 C (D-R14-3, SEC INFO-1): @behavior a review run's ledger, tamper mark, notice and Linux mount
 *   baseline land in ~/.oss/gate-state/<session>/ (0700, which config/tool-gates.json protects), and
 *   nothing new appears under ~/.oss/run/gate-run, which the served /oss:plan clean-up sweeps.
 *   A symlinked ~/.oss/gate-state is refused. Old ~/.oss/run/gate-run folders are left as they are.
 * @business-rule the agents a review reports to can't erase the marks that void it.
 */
describe('round 14 C: the gate state lives in ~/.oss/gate-state', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it("keeps a review run's marks, notice and mount baseline under ~/.oss/gate-state, none under ~/.oss/run/gate-run", () => {
    const home = tempHome();
    const old = path.join(home, '.oss', 'run', 'gate-run', 'left-behind');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'a.tamper'), 'x');

    mark(home, 's1', 'agent-1', 'started');
    mark(home, 's1', 'agent-1', 'tamper');
    storeNotice(home, 's1', 'agent-1', { kind: 'unverified', reason: REASONS.tampered });
    recordMountBaseline(home, 's1', 'agent-1', [{ device: '/dev/x', at: '/' }]);

    const root = path.join(home, '.oss', 'gate-state');
    expect(runRoot(home)).toBe(root);
    expect(mode(root)).toBe(0o700);
    const files = fs.readdirSync(path.join(root, 's1'));
    expect(files).toEqual(expect.arrayContaining(['agent-1.started', 'agent-1.tamper', 'agent-1.mounts']));
    expect(files.some((f) => f.endsWith('.notice.json'))).toBe(true);
    expect(fs.readdirSync(path.join(home, '.oss', 'run', 'gate-run'))).toEqual(['left-behind']);
    expect(fs.readdirSync(old)).toEqual(['a.tamper']);
  });

  it('refuses a symlinked ~/.oss/gate-state', () => {
    const home = tempHome();
    fs.mkdirSync(path.join(home, '.oss'));
    fs.symlinkSync(tempHome(), path.join(home, '.oss', 'gate-state'));

    expect(() => sessionFolder(home, 's1')).toThrow();
  });
});
