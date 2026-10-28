/**
 * @behavior oss-log.sh keeps every round of a command in its command log
 * @acceptance-criteria Running `init build` a second time in the same session appends a new banner
 *   instead of erasing the first round's entries
 * @business-rule A command log is the observable record that a command was invoked; each fix round
 *   must leave its own banner so rounds can be counted (`grep -c 'OSS Command: /oss:build'`)
 * @boundary Shell script (oss-log.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh command log rounds', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');

  let world: string;
  let home: string;
  let project: string;

  const runLog = (...args: string[]): string =>
    execFileSync('bash', [ossLogScript, ...args], {
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_CODE_SESSION_ID: '',
      },
      encoding: 'utf-8',
    });

  const readBuildLog = (): string =>
    fs.readFileSync(
      path.join(fs.realpathSync(project), '.oss/logs/current-session/build.log'),
      'utf-8'
    );

  const countBanners = (log: string): number =>
    log.split('\n').filter((line) => line.includes('OSS Command: /oss:build')).length;

  beforeEach(() => {
    world = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-rounds-'));
    home = path.join(world, 'home');
    project = path.join(world, 'project');
    fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
    fs.mkdirSync(path.join(project, '.oss'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(world, { recursive: true, force: true });
  });

  /**
   * @behavior A second round of the same command does not erase the first
   * @acceptance-criteria After init, write, init: two banners and the first round's entry remain
   */
  it('should keep both banners when a command is started twice', () => {
    runLog('init', 'build');
    runLog('write', 'build', 'round-one');
    runLog('init', 'build');

    const log = readBuildLog();

    expect(countBanners(log)).toBe(2);
    expect(log).toContain('round-one');
  });

  /**
   * @behavior The first run of a command still starts its log with a banner
   * @acceptance-criteria One init: exactly one banner, and the file begins with the banner rule
   */
  it('should still start a fresh log for a command that never ran', () => {
    runLog('init', 'build');

    const log = readBuildLog();

    expect(countBanners(log)).toBe(1);
    expect(log.startsWith('═══')).toBe(true);
  });
});
