/**
 * @behavior The single bundled binary serves BOTH roles: launcher and proxy. `resolveEntry`
 *           routes `oss-launch start-proxy …` to the proxy entry; everything else is a launch.
 *           `proxySpawnArgs` builds the spawn argv so a bundled binary re-invokes ITSELF with the
 *           `start-proxy` subcommand (no system node), while a node-script install spawns the
 *           start-proxy.js file. `isVersionRequest` recognizes `--version`/`-v`.
 * @boundary Pure launcher entry helpers (no spawning/IO)
 */
import { describe, it, expect } from 'vitest';
import {
  resolveEntry,
  proxySpawnArgs,
  isVersionRequest,
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
