/**
 * Runs a snippet of watcher code in a child node process under a hard time limit (T70d/T70e), so a read that
 * blocks (a FIFO) fails the test instead of blocking vitest. The snippet is TypeScript, bundled from watcher/src
 * with esbuild (imports resolve from src, e.g. './services/settings.js'); it prints its result with console.log.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildSync } from 'esbuild';

export const WATCHER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
/** A run that has not finished by now has hung. */
export const CHILD_LIMIT_MS = 10_000;
/** A test's own limit: room for CHILD_LIMIT_MS plus a slow child start on a busy machine. */
export const TEST_LIMIT_MS = 30_000;

export interface ChildRun {
  /** the child was killed at the time limit */
  hung: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ChildOptions {
  /** HOME (and so ~/.oss) for the child */
  home: string;
  /** working directory (a project) */
  cwd?: string;
  env?: Record<string, string>;
  /** a module that replaces `fs` for the bundled code (it may re-export node:fs) */
  fsShim?: string;
}

export function runInChild(code: string, options: ChildOptions): ChildRun {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-child-run-'));
  try {
    buildSync({
      stdin: { contents: code, resolveDir: WATCHER_SRC, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: path.join(work, 'entry.mjs'),
      logLevel: 'silent',
      ...(options.fsShim ? { alias: { fs: options.fsShim } } : {}),
    });
    // loaded through a second file, so no CLI module mistakes the bundle for its own main script
    fs.writeFileSync(path.join(work, 'run.mjs'), "await import('./entry.mjs');\n");
    const run = spawnSync(process.execPath, [path.join(work, 'run.mjs')], {
      cwd: options.cwd ?? options.home,
      encoding: 'utf-8',
      timeout: CHILD_LIMIT_MS,
      killSignal: 'SIGKILL',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: options.home, ...options.env },
    });
    return {
      hung: run.error !== undefined || run.signal === 'SIGKILL',
      status: run.status,
      stdout: run.stdout ?? '',
      stderr: run.stderr ?? '',
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
