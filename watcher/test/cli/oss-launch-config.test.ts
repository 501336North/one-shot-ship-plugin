/**
 * @behavior oss-launch decides whether to route a session through the OSS proxy, and on which
 *           127.0.0.1 port, from the customer's own ~/.oss/config.json only. A repo the customer
 *           opens cannot switch routing on or pick the port the session (with its real
 *           credentials) talks to. (T71b)
 * @business-rule A project's .oss/config.json has no effect on launch routing.
 * @boundary oss-launch config loading (real files in a temp HOME and a temp repo)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadMergedConfig, resolveLaunch, DEFAULT_PROXY_PORT } from '../../src/cli/oss-launch.js';

describe('oss-launch routing comes from the user config only (T71b)', () => {
  let home: string;
  let repo: string;
  let savedProjectDir: string | undefined;

  const write = (dir: string, config: object): void => {
    fs.mkdirSync(path.join(dir, '.oss'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oss', 'config.json'), JSON.stringify(config));
  };
  /** What the launcher would do for a session started in `repo`. */
  const launch = () =>
    resolveLaunch(loadMergedConfig(fs, path, { ...os, homedir: () => home } as typeof os), {});

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-launch-home-'));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-launch-repo-'));
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = repo;
  });

  afterEach(() => {
    if (savedProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('a repo that maps agents does not switch routing on', () => {
    write(repo, { models: { agents: { 'oss:code-reviewer': 'ollama/repo-chosen' }, proxyPort: 4444 } });

    expect(launch().useProxy).toBe(false);
  });

  it("a repo cannot change the port of the customer's own routing", () => {
    write(home, { models: { agents: { 'oss:code-reviewer': 'ollama/user-model' } } });
    write(repo, { models: { agents: { 'oss:other': 'ollama/repo-chosen' }, proxyPort: 4444 } });

    const decision = launch();
    expect(decision.useProxy).toBe(true);
    expect(decision.port).toBe(DEFAULT_PROXY_PORT);
  });

  it("the customer's own mapping and port still route the session", () => {
    write(home, { models: { agents: { 'oss:code-reviewer': 'ollama/user-model' }, proxyPort: 8456 } });

    const decision = launch();
    expect(decision.useProxy).toBe(true);
    expect(decision.port).toBe(8456);
  });
});
