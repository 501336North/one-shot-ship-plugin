/**
 * Behaviour: every watcher test runs in a sandbox. The global setup gives it a
 * home folder of its own, hides the live Claude session, and never touches the
 * user's files or other programs' processes.
 *
 * Runs a child vitest with the real config on a one-test probe. The child can
 * never reach real pkill/killall/find: recording stubs come first on its PATH.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

interface ProbeReport {
  homedir: string;
  HOME: string | null;
  CLAUDE_CODE_SESSION_ID: string | null;
  CLAUDE_PROJECT_DIR: string | null;
  OSS_CONFIG_DIR: string | null;
  CLAUDE_PLUGIN_ROOT: string | null;
  OSS_MANIFEST_URL: string | null;
  ossDir: { isDirectory: boolean; entries: string[] } | null;
}

const watcherDir = path.resolve(__dirname, '..');
const vitestBin = path.join(watcherDir, 'node_modules', 'vitest', 'vitest.mjs');
const probeFile = path.join('test', 'fixtures', 'setup-probe', 'probe.test.ts');

let sandbox: string;
let fakeRealHome: string;
let pidFile: string;
let killLog: string;
let findLog: string;
let probeOut: string;
let childStatus: number | null;
let childOutput: string;

function writeRecordingStub(binDir: string, name: string, log: string): void {
  const stub = path.join(binDir, name);
  fs.writeFileSync(stub, `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 0\n`);
  fs.chmodSync(stub, 0o755);
}

function lines(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

function probe(): ProbeReport {
  return JSON.parse(fs.readFileSync(probeOut, 'utf8')) as ProbeReport;
}

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-setup-isolation-')));
  fakeRealHome = path.join(sandbox, 'real-home');
  fs.mkdirSync(path.join(fakeRealHome, '.oss', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(fakeRealHome, '.oss', 'current-project'), '/live/project\n');
  fs.writeFileSync(path.join(fakeRealHome, '.oss', 'logs', 'sentinel'), 'keep me\n');

  const binDir = path.join(sandbox, 'bin');
  fs.mkdirSync(binDir);
  killLog = path.join(sandbox, 'kill-calls.log');
  findLog = path.join(sandbox, 'find-calls.log');
  writeRecordingStub(binDir, 'pkill', killLog);
  writeRecordingStub(binDir, 'killall', killLog);
  writeRecordingStub(binDir, 'find', findLog);

  const childTmp = path.join(sandbox, 'tmp');
  fs.mkdirSync(path.join(childTmp, 'other-run', '.oss'), { recursive: true });
  pidFile = path.join(childTmp, 'other-run', '.oss', 'watcher.pid');
  fs.writeFileSync(pidFile, '12345\n');

  probeOut = path.join(sandbox, 'probe.json');

  const result = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', 'vitest.config.ts', probeFile],
    {
      cwd: watcherDir,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        HOME: fakeRealHome,
        TMPDIR: childTmp,
        CLAUDE_CODE_SESSION_ID: 'live-session',
        CLAUDE_PROJECT_DIR: '/some/live/project',
        // A developer's own overrides: the real config (and its key), the
        // installed plugin, and the manifest URL. Here they point at the sandbox.
        OSS_CONFIG_DIR: path.join(fakeRealHome, '.oss'),
        CLAUDE_PLUGIN_ROOT: path.join(sandbox, 'live-plugin'),
        OSS_MANIFEST_URL: 'http://127.0.0.1:9/manifest.json',
        OSS_SETUP_PROBE_OUT: probeOut,
      },
    }
  );
  childStatus = result.status;
  childOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
}, 90_000);

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('global test setup (setup.ts)', () => {
  it('ran the probe in a child vitest with the real config', () => {
    expect(childStatus, childOutput).toBe(0);
    expect(fs.existsSync(probeOut), childOutput).toBe(true);
  });

  it("should give tests a home folder that is not the user's", () => {
    const seen = probe();
    expect(seen.homedir).not.toBe(fakeRealHome);
    expect(seen.HOME).toBe(seen.homedir);
  });

  it('should give tests a home that has an empty .oss folder, like a real install', () => {
    expect(probe().ossDir).toEqual({ isDirectory: true, entries: [] });
  });

  it('should hide the live session from tests', () => {
    const seen = probe();
    expect(seen.CLAUDE_CODE_SESSION_ID).toBeNull();
    expect(seen.CLAUDE_PROJECT_DIR).toBeNull();
  });

  it("should not let tests see the user's config folder, so no hook can read the real key", () => {
    expect(probe().OSS_CONFIG_DIR).toBeNull();
  });

  it("should not let tests run the user's installed plugin", () => {
    expect(probe().CLAUDE_PLUGIN_ROOT).toBeNull();
  });

  it("should not let tests fetch the user's manifest URL", () => {
    expect(probe().OSS_MANIFEST_URL).toBeNull();
  });

  it("should leave the user's real ~/.oss alone", () => {
    expect(fs.readFileSync(path.join(fakeRealHome, '.oss', 'current-project'), 'utf8')).toBe(
      '/live/project\n'
    );
    expect(fs.readFileSync(path.join(fakeRealHome, '.oss', 'logs', 'sentinel'), 'utf8')).toBe(
      'keep me\n'
    );
  });

  it('should not kill processes it did not start', () => {
    expect(lines(killLog)).toEqual([]);
  });

  it("should not delete other runs' watcher pid files", () => {
    expect(lines(findLog).filter((l) => l.includes('-delete'))).toEqual([]);
    expect(fs.existsSync(pidFile)).toBe(true);
  });
});
