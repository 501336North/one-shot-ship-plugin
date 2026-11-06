/**
 * @behavior The single bundled binary serves BOTH roles: launcher and proxy. `resolveEntry`
 *           routes `oss-launch start-proxy …` to the proxy entry; everything else is a launch.
 *           `proxySpawnArgs` builds the spawn argv so a bundled binary re-invokes ITSELF with the
 *           `start-proxy` subcommand (no system node), while a node-script install spawns the
 *           start-proxy.js file. `isVersionRequest` recognizes `--version`/`-v`.
 * @boundary Pure launcher entry helpers (no spawning/IO)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveEntry,
  proxySpawnArgs,
  isVersionRequest,
  spawnRouterProxy,
} from '../../src/cli/oss-launch.js';

describe('resolveEntry', () => {
  it('routes a leading start-proxy subcommand to the proxy entry', () => {
    expect(resolveEntry(['start-proxy', '--router', '--port', '8473'])).toBe('start-proxy');
  });
  it('treats everything else as a launch', () => {
    expect(resolveEntry(['-p', '/oss:build'])).toBe('launch');
    expect(resolveEntry([])).toBe('launch');
    expect(resolveEntry(['--version'])).toBe('launch');
  });
});

describe('proxySpawnArgs', () => {
  it('bundled binary re-invokes itself with the start-proxy subcommand (no system node)', () => {
    expect(proxySpawnArgs({ bundled: true, startProxyJs: '/x/start-proxy.js', port: 8473 })).toEqual([
      'start-proxy',
      '--router',
      '--background',
      '--port',
      '8473',
    ]);
  });
  it('node-script install spawns the start-proxy.js file', () => {
    expect(proxySpawnArgs({ bundled: false, startProxyJs: '/x/start-proxy.js', port: 8473 })).toEqual([
      '/x/start-proxy.js',
      '--router',
      '--background',
      '--port',
      '8473',
    ]);
  });
});

/**
 * @behavior T89b: a routed launch from the pkg binary starts its proxy. pkg marks every child with
 *   PKG_EXECPATH=<the binary>; a child that sees that runs its next argument as a script, so
 *   `oss-launch start-proxy` would crash. The bundled self-spawn clears it and keeps the rest of env.
 */
describe('spawnRouterProxy', () => {
  const run = (bundled: boolean) => {
    const child = { unref: vi.fn() };
    const spawn = vi.fn(() => child);
    spawnRouterProxy({
      bundled,
      startProxyJs: '/x/start-proxy.js',
      port: 18999,
      execPath: '/bin/oss-launch',
      env: { HOME: '/home/t89', PKG_EXECPATH: '/bin/oss-launch' },
      spawn,
    });
    return { child, spawn };
  };

  it('bundled binary: re-runs itself as start-proxy, detached, with PKG_EXECPATH cleared and HOME kept', () => {
    const { child, spawn } = run(true);
    expect(spawn).toHaveBeenCalledWith(
      '/bin/oss-launch',
      ['start-proxy', '--router', '--background', '--port', '18999'],
      { detached: true, stdio: 'ignore', env: { HOME: '/home/t89', PKG_EXECPATH: '' } }
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('node-script install: runs start-proxy.js detached', () => {
    const { spawn } = run(false);
    expect(spawn).toHaveBeenCalledWith(
      '/bin/oss-launch',
      ['/x/start-proxy.js', '--router', '--background', '--port', '18999'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });
});

describe('isVersionRequest', () => {
  it('recognizes --version and -v', () => {
    expect(isVersionRequest(['--version'])).toBe(true);
    expect(isVersionRequest(['-v'])).toBe(true);
  });
  it('is false for normal launches', () => {
    expect(isVersionRequest(['-p', 'x'])).toBe(false);
    expect(isVersionRequest([])).toBe(false);
  });
});
