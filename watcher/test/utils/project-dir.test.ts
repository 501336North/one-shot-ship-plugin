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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
