/**
 * The hang-safe reader keeps each caller's own error rule (Task 70e round 2)
 *
 * @behavior A caller that used "exists? then read" still treats a file it cannot find (missing, a link loop) as
 *           missing, and still fails, as before, on a file it found but may not read (EACCES). A caller that
 *           reported an unreadable file as corrupted still does.
 * @business-rule Routing reads through the reader must not turn a permission problem into "no file" (a second
 *           watcher would start beside a running one) nor turn "no file" into a crash.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Watcher } from '../../src/index.js';
import { QueueManager } from '../../src/queue/manager.js';
import { LogReader } from '../../src/logger/log-reader.js';
import { OnboardingService } from '../../src/services/onboarding.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-user-file-errors-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A file at `name` the person may not read (mode 000). */
function unreadable(name: string, text = '1'): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o000);
  expect(() => fs.readFileSync(file), 'run as a non-root user').toThrow();
  return file;
}

/** A link loop at `name`. */
function loop(name: string): void {
  fs.symlinkSync(path.join(dir, `${name}.b`), path.join(dir, name));
  fs.symlinkSync(path.join(dir, name), path.join(dir, `${name}.b`));
}

describe('callers keep their error rule (Task 70e round 2)', () => {
  it('a watcher.pid the person may not read is an error, not "no watcher running"', async () => {
    unreadable('watcher.pid');

    await expect(new Watcher(dir, 'k').isAnotherWatcherRunning()).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('a workflow.log the person may not read is an error; a log that is a link loop reads as no entries', async () => {
    unreadable('workflow.log');
    await expect(new LogReader(dir).readAll()).rejects.toMatchObject({ code: 'EACCES' });

    fs.rmSync(path.join(dir, 'workflow.log'), { force: true });
    loop('workflow.log');
    await expect(new LogReader(dir).readAll()).resolves.toEqual([]);
  });

  it('a queue.json that is a link loop is a missing queue: the watcher starts with an empty one', async () => {
    loop('queue.json');
    const q = new QueueManager(dir);
    await q.initialize();

    expect(await q.getTasks()).toEqual([]);
  });

  it('a queue.json the person may not read is an error, as before', async () => {
    unreadable('queue.json', '{"tasks":[]}');

    await expect(new QueueManager(dir).initialize()).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('setup validation reports an unreadable config.json as corrupted, not as missing', async () => {
    unreadable('config.json', '{"apiKey":"k"}');
    const result = await new OnboardingService({ configDir: dir }).validateSetup();

    expect(result.issues).toContain('Config file is corrupted - run /oss:login');
  });
});
