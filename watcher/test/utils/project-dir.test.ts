/**
 * @behavior With two projects open (A, and B whose session started last so ~/.oss/current-project
 *           names B), a CLI run inside A - any subfolder, no CLAUDE_PROJECT_DIR - resolves A. From
 *           a repo with no .oss, or one whose .oss is a committed link, it resolves no project (the
 *           caller then uses the global ~/.oss). CLAUDE_PROJECT_DIR, when set, still wins.
 * @business-rule notify-routing-unify D1: the TS twin of oss_resolve_project in
 *           hooks/oss-safe-path.sh - CLAUDE_PROJECT_DIR, else the nearest real (not linked) .oss
 *           walking up from the cwd bounded by the git toplevel, else none. current-project is
 *           never read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveProjectDir } from '../../src/utils/project-dir.js';

describe('resolveProjectDir', () => {
  let root: string;
  let home: string;
  let a: string;
  let b: string;
  const repo = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    execSync('git init -q', { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-project-dir-')));
    home = path.join(root, 'home');
    a = path.join(home, 'projA');
    b = path.join(home, 'projB');
    repo(a);
    repo(b);
    fs.mkdirSync(path.join(a, '.oss'));
    fs.mkdirSync(path.join(a, 'sub', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(b, '.oss'));
    fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
    fs.writeFileSync(path.join(home, '.oss', 'current-project'), `${b}\n`);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves project A from a subfolder of A, never the current-project B', () => {
    expect(resolveProjectDir({ HOME: home }, path.join(a, 'sub', 'deep'))).toBe(a);
  });

  it('resolves no project from a repo with no .oss (never B)', () => {
    const c = path.join(home, 'projC');
    repo(c);
    expect(resolveProjectDir({ HOME: home }, c)).toBeNull();
  });

  it('resolves no project when the repo commits .oss as a link (never the target, never B)', () => {
    const d = path.join(home, 'projD');
    repo(d);
    fs.mkdirSync(path.join(root, 'target'));
    fs.symlinkSync(path.join(root, 'target'), path.join(d, '.oss'));
    expect(resolveProjectDir({ HOME: home }, d)).toBeNull();
  });

  it('does not walk above the git toplevel (a nested repo with no .oss borrows nothing)', () => {
    const inner = path.join(a, 'inner');
    repo(inner);
    expect(resolveProjectDir({ HOME: home }, inner)).toBeNull();
  });

  it('resolves no project outside any git repo', () => {
    expect(resolveProjectDir({ HOME: home }, home)).toBeNull();
  });

  it('keeps CLAUDE_PROJECT_DIR first when it is set', () => {
    expect(resolveProjectDir({ HOME: home, CLAUDE_PROJECT_DIR: b }, path.join(a, 'sub'))).toBe(b);
  });
});

/**
 * @behavior A CLI run in a session whose SessionStart pointer names product B resolves B from any
 *           cwd - unless a folder or the file of that pointer belongs to another user (then the cwd
 *           walk decides, never the pointer). Shell twin: oss_session_project.
 * @business-rule notify-routing-unify D2: the pointer is trusted only when the user owns it.
 */
describe('resolveProjectDir: the session pointer', () => {
  let root: string;
  let home: string;
  let b: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-project-ptr-')));
    home = path.join(root, 'home');
    b = path.join(root, 'prodB');
    fs.mkdirSync(path.join(b, '.oss'), { recursive: true });
    fs.mkdirSync(path.join(home, '.oss', 'sessions', 'S2'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(home, '.oss', 'sessions', 'S2', 'project'), `${b}\n`, { mode: 0o600 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves this session's product from a folder outside any repo", () => {
    expect(resolveProjectDir({ HOME: home, CLAUDE_CODE_SESSION_ID: 'S2' }, root)).toBe(b);
  });

  it("resolves another repo's own .oss over the pointer (session started in B, now working in C)", () => {
    const c = path.join(root, 'prodC');
    fs.mkdirSync(path.join(c, '.oss'), { recursive: true });
    fs.mkdirSync(path.join(c, 'sub'));
    execSync('git init -q', { cwd: c, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    expect(resolveProjectDir({ HOME: home, CLAUDE_CODE_SESSION_ID: 'S2' }, path.join(c, 'sub'))).toBe(c);
  });

  it("keeps the pointer's product for a stray .oss inside the pointer's own repo", () => {
    execSync('git init -q', { cwd: b, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    const stray = path.join(b, 'sub', 'stray');
    fs.mkdirSync(path.join(stray, '.oss'), { recursive: true });
    expect(resolveProjectDir({ HOME: home, CLAUDE_CODE_SESSION_ID: 'S2' }, stray)).toBe(b);
  });

  it('ignores a pointer owned by another user', () => {
    const me = process.geteuid?.() ?? 0;
    vi.spyOn(process, 'geteuid').mockReturnValue(me + 1);
    expect(resolveProjectDir({ HOME: home, CLAUDE_CODE_SESSION_ID: 'S2' }, root)).toBeNull();
  });
});
