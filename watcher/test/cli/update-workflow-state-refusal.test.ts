/**
 * @behavior When the write guard refuses the project's state file (e.g. it is a symlink), the
 *           state CLI does not claim success: no success line on stdout, the refusal on stderr,
 *           and a non-zero exit
 * @business-rule F10: "Step completed: build" must never be printed for a write that did not happen
 * @boundary CLI (dist/cli/update-workflow-state.js)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');

describe('update-workflow-state CLI - refused write (F10)', () => {
  let root: string;
  let project: string;
  let elsewhere: string;
  let original: string;

  function sandboxEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env, HOME: path.join(root, 'home') };
    delete env.CLAUDE_PROJECT_DIR;
    return env;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-refusal-'));
    project = path.join(root, 'project');
    elsewhere = path.join(root, 'elsewhere.json');
    fs.mkdirSync(path.join(root, 'home', '.oss'), { recursive: true });
    fs.mkdirSync(path.join(project, '.oss'), { recursive: true });
    // A real state file (written by the CLI itself), moved out of the project and linked back in
    const stateFile = path.join(project, '.oss', 'workflow-state.json');
    spawnSync('node', [cliPath, '--project-dir', project, 'init'], { env: sandboxEnv() });
    fs.renameSync(stateFile, elsewhere);
    original = fs.readFileSync(elsewhere, 'utf-8');
    fs.symlinkSync(elsewhere, stateFile);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['completeStep', 'build'],
    ['clearCurrentCommand'],
    ['clearTddPhase'],
    ['setLastCommand', 'build'],
  ])('%s through a symlinked state file prints no success line and exits non-zero', (...args) => {
    const env = sandboxEnv();

    const run = spawnSync('node', [cliPath, '--project-dir', project, ...args], { env, encoding: 'utf-8' });

    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('refusing unsafe .oss path');
    expect(run.status).not.toBe(0);
    expect(fs.readFileSync(elsewhere, 'utf-8')).toBe(original);
  });

  it('control: a plain state file is written and the success line is printed', () => {
    fs.unlinkSync(path.join(project, '.oss', 'workflow-state.json'));
    const env = sandboxEnv();

    const run = spawnSync('node', [cliPath, '--project-dir', project, 'completeStep', 'build'], { env, encoding: 'utf-8' });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Step completed: build');
  });
});
