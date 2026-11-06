/**
 * @behavior oss-notify.sh writes workflow state to project .oss/ via CLI
 * @acceptance-criteria Workflow state updates go to the project the command runs in (D1 routing)
 * @business-rule Multi-project support requires notifications to update correct project state
 * @boundary Shell script (oss-notify.sh)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

describe('oss-notify.sh - Project State Updates', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const notifyScript = path.join(hooksDir, 'oss-notify.sh');

  // This file owns its HOME (no apiKey, so no analytics call is possible) and a recording curl,
  // so it stays hermetic even without setup.ts.
  let fileRoot = '';
  let fileHome = '';
  let stubBin = '';
  let ossDir = '';
  let currentProjectFile = '';
  let globalWorkflowFile = '';
  let testProjectDir = '';
  let projectWorkflowFile = '';
  let curlCalls = '';

  beforeAll(() => {
    fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notify-project-'));
    fileHome = path.join(fileRoot, 'home');
    ossDir = path.join(fileHome, '.oss');
    fs.mkdirSync(ossDir, { recursive: true, mode: 0o700 });
    currentProjectFile = path.join(ossDir, 'current-project');
    globalWorkflowFile = path.join(ossDir, 'workflow-state.json');
    stubBin = path.join(fileRoot, 'bin');
    writeWarmStub(path.join(stubBin, 'curl'), 'printf "%s\\n" "$*" >> "$CURL_CALLS"\nexit 0\n');
  }, WARMUP_TIMEOUT_MS);

  afterAll(() => {
    fs.rmSync(fileRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testProjectDir = path.join(fileRoot, `project-${id}`);
    projectWorkflowFile = path.join(testProjectDir, '.oss', 'workflow-state.json');
    curlCalls = path.join(fileRoot, `curl-calls-${id}`);
    // Create test project (a git repo) with .oss
    fs.mkdirSync(path.join(testProjectDir, '.oss'), { recursive: true });
    execSync('git init -q', { cwd: testProjectDir });
  });

  afterEach(() => {
    fs.rmSync(testProjectDir, { recursive: true, force: true });
    fs.rmSync(currentProjectFile, { force: true });
    fs.rmSync(globalWorkflowFile, { force: true });
  });

  function runNotify(args: string[]): void {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: fileHome,
      PATH: `${stubBin}:${process.env.PATH ?? ''}`,
      CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
      CURL_CALLS: curlCalls,
    };
    // The Bash tool does not set CLAUDE_PROJECT_DIR; the live session id must never reach the hook;
    // OSS_CONFIG_DIR would move the config (and its apiKey) out of fileHome.
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.OSS_CONFIG_DIR;
    // fd 3 is a pipe that the hook's detached jobs inherit (they redirect only 0-2), so spawnSync
    // returns only once every one of them has exited: the curl record is complete, not racing.
    spawnSync('bash', [notifyScript, ...args], {
      cwd: testProjectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
  }

  /**
   * @behavior oss-notify.sh workflow start updates project state via CLI
   * @acceptance-criteria activeStep written to project .oss/workflow-state.json
   */
  it('should write workflow state to project .oss when run inside the project', () => {
    // GIVEN: the command runs inside the test project; current-project names another (never used, D1)
    fs.writeFileSync(currentProjectFile, fileHome);

    // WHEN: Running notify script with workflow start
    runNotify(['--workflow', 'build', 'start', '{}']);

    // THEN: Project workflow-state.json should have build as active step
    expect(fs.existsSync(projectWorkflowFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
    expect(state.activeStep).toBe('build');
  }, 20000);

  /**
   * @behavior oss-notify.sh does NOT write workflow state to global when project is set
   * @acceptance-criteria Global ~/.oss/workflow-state.json version unchanged after project-scoped update
   * @business-rule Status line reads project-local state, so writes must go there too
   */
  it('should NOT modify global workflow-state.json when run inside the project', () => {
    // GIVEN: the command runs inside the test project; current-project names another (never used, D1)
    fs.writeFileSync(currentProjectFile, fileHome);

    // AND: Global state has a known version
    const globalStateBefore = fs.existsSync(globalWorkflowFile)
      ? JSON.parse(fs.readFileSync(globalWorkflowFile, 'utf-8'))
      : { version: 0 };
    const globalVersionBefore = globalStateBefore.version ?? 0;

    // WHEN: Running notify with workflow start (writes activeStep, currentCommand, etc.)
    runNotify(['--workflow', 'build', 'start', '{}']);

    // THEN: Global state version should NOT have changed
    const globalStateAfter = fs.existsSync(globalWorkflowFile)
      ? JSON.parse(fs.readFileSync(globalWorkflowFile, 'utf-8'))
      : { version: 0 };
    expect(globalStateAfter.version).toBe(globalVersionBefore);

    // AND: Project-local state should have the update
    expect(fs.existsSync(projectWorkflowFile)).toBe(true);
    const projectState = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
    expect(projectState.activeStep).toBe('build');
  }, 20000);

  /**
   * @behavior oss-notify.sh task_complete updates project progress
   * @acceptance-criteria progress written to project .oss/workflow-state.json
   */
  it('should update project progress on task_complete', () => {
    // GIVEN: the command runs inside the test project; current-project names another (never used, D1)
    fs.writeFileSync(currentProjectFile, fileHome);

    // AND: Project has initial state from build start
    fs.writeFileSync(projectWorkflowFile, JSON.stringify({
      activeStep: 'build',
      supervisor: 'watching'
    }));

    // WHEN: Running notify script with task_complete
    runNotify(['--workflow', 'build', 'task_complete', '{"current": 3, "total": 10, "taskName": "Test task"}']);

    // THEN: Project state should have progress updated
    const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
    expect(state.progress).toContain('3/10');
  }, 20000);

  /**
   * @behavior a test run of the workflow hook never reaches the OSS API
   * @business-rule `start` posts analytics when a key is configured; tests run logged out, so nothing is sent
   */
  it('should send nothing to the network', () => {
    // WHEN: the hook takes its only network path (workflow start -> analytics POST)
    runNotify(['--workflow', 'build', 'start', '{}']);

    // THEN: the curl stub recorded no call
    const calls = fs.existsSync(curlCalls) ? fs.readFileSync(curlCalls, 'utf-8') : '';
    expect(calls).toBe('');
  }, 20000);
});
