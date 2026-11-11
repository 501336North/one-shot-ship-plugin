/**
 * @behavior The workflow state remembers when the current command started
 * @acceptance-criteria Starting a different command records a fresh start time; repeating the same command keeps it
 * @business-rule ADR-008: "this build" is identified by the build's start stamp, so a red test from an earlier build doesn't count
 * @boundary CLI (update-workflow-state.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('update-workflow-state CLI - command start stamp', () => {
  const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  let testProjectDir: string;
  let stateFile: string;

  const run = (...args: string[]): void => {
    execFileSync('node', [cliPath, '--project-dir', testProjectDir, ...args], {
      timeout: 10000,
      encoding: 'utf-8',
    });
  };

  const readState = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;

  beforeEach(() => {
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-cmd-started-'));
    fs.mkdirSync(path.join(testProjectDir, '.oss'), { recursive: true });
    stateFile = path.join(testProjectDir, '.oss', 'workflow-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({}));
  });

  afterEach(() => {
    fs.rmSync(testProjectDir, { recursive: true, force: true });
  });

  it('should set currentCommandStartedAt when currentCommand changes', () => {
    // GIVEN: a plan was running, started long ago
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ currentCommand: 'plan', currentCommandStartedAt: '2020-01-01T00:00:00.000Z' })
    );

    // WHEN: the build starts
    const before = Date.now();
    run('setCurrentCommand', 'build');
    const after = Date.now();

    // THEN: the state records when the build started
    const stamp = readState().currentCommandStartedAt;
    expect(typeof stamp).toBe('string');
    const startedAt = new Date(stamp as string);
    expect(startedAt.toISOString()).toBe(stamp);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(startedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('should keep currentCommandStartedAt when currentCommand is set to the same value', () => {
    // GIVEN: a build already running with a known start time
    const original = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(stateFile, JSON.stringify({ currentCommand: 'build', currentCommandStartedAt: original }));

    // WHEN: the build is announced again
    run('setCurrentCommand', 'build');

    // THEN: the start time is unchanged
    const state = readState();
    expect(state.currentCommand).toBe('build');
    expect(state.currentCommandStartedAt).toBe(original);
  });
});
