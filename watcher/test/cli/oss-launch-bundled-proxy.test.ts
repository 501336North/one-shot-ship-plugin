/**
 * @behavior T89: `oss-launch start-proxy --router --background --port N` in the self-contained
 *   binary brings a router proxy up that answers /health.
 * @business-rule The single binary is both launcher and proxy. Its background child must be told
 *   `start-proxy`, or it runs as the launcher and local routing never starts.
 * @boundary CLI (the esbuild bundle that pkg wraps, built with the same options as the release)
 *
 * In the real binary process.execPath IS oss-launch. Here the bundle runs under node, so a
 * preload points process.execPath at a shim that runs `node oss-launch.cjs "$@"`, which is how
 * the binary behaves. PATH holds no `claude`, so a child that wrongly runs as the launcher exits.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import { spawnSync } from 'child_process';
import { buildSync } from 'esbuild';
import { OSS_LAUNCH_BUNDLE_OPTIONS } from '../../scripts/oss-launch-bundle-options.mjs';

const HEALTH_LIMIT_MS = 10_000;
const TEST_LIMIT_MS = 30_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function healthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('bundled oss-launch: background router proxy (T89)', () => {
  let work = '';
  let started = 0;

  afterEach(() => {
    if (started && alive(started)) {
      process.kill(started, 'SIGKILL');
    }
    started = 0;
    if (work) fs.rmSync(work, { recursive: true, force: true });
    work = '';
  });

  it(
    'answers /health on the requested port',
    async () => {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-t89-'));
      const home = path.join(work, 'home');
      fs.mkdirSync(home);
      const bundle = path.join(work, 'oss-launch.cjs');
      buildSync({ ...OSS_LAUNCH_BUNDLE_OPTIONS, outfile: bundle, logLevel: 'silent' });

      const shim = path.join(work, 'oss-launch');
      fs.writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(bundle)} "$@"\n`);
      fs.chmodSync(shim, 0o755);
      const preload = path.join(work, 'as-binary.cjs');
      fs.writeFileSync(preload, `process.execPath = ${JSON.stringify(shim)};\n`);

      let port = await freePort();
      while (port === 8473) port = await freePort();

      const run = spawnSync(
        process.execPath,
        ['-r', preload, bundle, 'start-proxy', '--router', '--background', '--port', String(port)],
        {
          cwd: work,
          encoding: 'utf-8',
          timeout: HEALTH_LIMIT_MS,
          killSignal: 'SIGKILL',
          env: { PATH: '/usr/bin:/bin', HOME: home },
        }
      );
      const out = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}') as { pid?: number; background?: boolean };
      started = out.pid ?? 0;
      expect(out.background).toBe(true);
      expect(started).toBeGreaterThan(0);

      let up = false;
      const deadline = Date.now() + HEALTH_LIMIT_MS;
      while (!up && Date.now() < deadline) {
        up = await healthy(port);
        if (!up) await new Promise((r) => setTimeout(r, 200));
      }
      expect(up).toBe(true);
    },
    TEST_LIMIT_MS
  );
});
