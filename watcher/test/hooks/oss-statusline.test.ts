/**
 * @behavior Status line reads workflow state from project .oss/ when current-project set
 * @acceptance-criteria Status line shows project-specific TDD phase and queue
 * @business-rule Multi-project support requires reading from active project's state
 * @boundary Shell script (oss-statusline.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-statusline.sh - Project State Reading', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const globalWorkflowFile = path.join(ossDir, 'workflow-state.json');
  const globalQueueFile = path.join(ossDir, 'queue.json');
  const testProjectDir = path.join(os.tmpdir(), `oss-statusline-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');
  const projectQueueFile = path.join(projectOssDir, 'queue.json');

  // Save original state
  let originalCurrentProject: string | null = null;
  let originalGlobalWorkflow: string | null = null;
  let originalGlobalQueue: string | null = null;

  beforeEach(() => {
    // Save original files
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    if (fs.existsSync(globalWorkflowFile)) {
      originalGlobalWorkflow = fs.readFileSync(globalWorkflowFile, 'utf-8');
    }
    if (fs.existsSync(globalQueueFile)) {
      originalGlobalQueue = fs.readFileSync(globalQueueFile, 'utf-8');
    }

    // Create test project directory with .oss
    fs.mkdirSync(projectOssDir, { recursive: true });

    // Initialize as git repo (for branch detection in statusline)
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git checkout -b feat/test-branch', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git init might fail in some environments
    }
  });

  afterEach(() => {
    // Restore original files
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

    if (originalGlobalWorkflow !== null) {
      fs.writeFileSync(globalWorkflowFile, originalGlobalWorkflow);
    }
    if (originalGlobalQueue !== null) {
      fs.writeFileSync(globalQueueFile, originalGlobalQueue);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('Workflow state reading', () => {
    /**
     * @behavior Status line reads TDD phase from project .oss/ when current-project set
     * @acceptance-criteria Output contains project-specific TDD phase (RED)
     */
    it('should read workflow state from project .oss/ when current-project set', () => {
      // GIVEN: Project has RED TDD phase in its .oss/workflow-state.json
      const projectState = {
        tddPhase: 'red',
        supervisor: 'watching',
        currentCommand: 'build'
      };
      fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));

      // AND: Global state has different phase (GREEN)
      const globalState = {
        tddPhase: 'green',
        supervisor: 'idle',
        currentCommand: 'plan'
      };
      fs.writeFileSync(globalWorkflowFile, JSON.stringify(globalState));

      // AND: current-project points to test project
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show RED (from project) not GREEN (from global)
      expect(output).toContain('RED');
      expect(output).not.toContain('GREEN');
    });

    /**
     * @behavior Status line falls back to global when no current-project set
     * @acceptance-criteria Output uses global state when current-project is empty
     */
    it('should fall back to global state when current-project is empty', () => {
      // GIVEN: Global state has GREEN TDD phase
      const globalState = {
        tddPhase: 'green',
        supervisor: 'watching',
        currentCommand: 'build'
      };
      fs.writeFileSync(globalWorkflowFile, JSON.stringify(globalState));

      // AND: current-project is empty
      fs.writeFileSync(currentProjectFile, '');

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show GREEN (from global)
      expect(output).toContain('GREEN');
    });

    /**
     * @behavior Status line falls back to global when project has no .oss/ state
     * @acceptance-criteria Output uses global state when project .oss/ missing
     */
    it('should fall back to global state when project has no workflow state', () => {
      // GIVEN: Global state has GREEN TDD phase
      const globalState = {
        tddPhase: 'green',
        supervisor: 'watching',
        currentCommand: 'build'
      };
      fs.writeFileSync(globalWorkflowFile, JSON.stringify(globalState));

      // AND: Project .oss exists but has no workflow-state.json
      if (fs.existsSync(projectWorkflowFile)) {
        fs.unlinkSync(projectWorkflowFile);
      }

      // AND: current-project points to test project
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show GREEN (from global fallback)
      expect(output).toContain('GREEN');
    });
  });

  describe('Multi-session isolation (race condition fix)', () => {
    /**
     * @behavior Status line uses workspace.current_dir from stdin, ignores ~/.oss/current-project
     * @acceptance-criteria When current-project points to Project B, but stdin says Project A,
     *                      status line should show Project A's state (not Project B's)
     * @business-rule Multi-session support requires each session to use its own project context
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should use workspace.current_dir from stdin, NOT ~/.oss/current-project', () => {
      // GIVEN: Two projects with different TDD phases
      const projectADir = path.join(os.tmpdir(), `oss-project-A-${Date.now()}`);
      const projectBDir = path.join(os.tmpdir(), `oss-project-B-${Date.now()}`);

      // Create both project directories
      fs.mkdirSync(path.join(projectADir, '.oss'), { recursive: true });
      fs.mkdirSync(path.join(projectBDir, '.oss'), { recursive: true });

      // Project A has RED phase
      fs.writeFileSync(
        path.join(projectADir, '.oss', 'workflow-state.json'),
        JSON.stringify({ tddPhase: 'red', currentCommand: 'build' })
      );

      // Project B has GREEN phase
      fs.writeFileSync(
        path.join(projectBDir, '.oss', 'workflow-state.json'),
        JSON.stringify({ tddPhase: 'green', currentCommand: 'plan' })
      );

      // Initialize git repos for branch detection
      try {
        execSync('git init && git checkout -b feat/a', { cwd: projectADir, stdio: 'ignore' });
        execSync('git init && git checkout -b feat/b', { cwd: projectBDir, stdio: 'ignore' });
      } catch {
        // Git init might fail
      }

      // CRITICAL: ~/.oss/current-project points to Project B (simulating another session)
      fs.writeFileSync(currentProjectFile, projectBDir);

      // WHEN: Running statusline with stdin saying we're in Project A
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: projectADir }  // <-- This is the truth for THIS session
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: projectADir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show RED (Project A), NOT GREEN (Project B)
      // This proves we're using stdin's workspace.current_dir, not ~/.oss/current-project
      expect(output).toContain('RED');
      expect(output).not.toContain('GREEN');

      // Cleanup
      fs.rmSync(projectADir, { recursive: true, force: true });
      fs.rmSync(projectBDir, { recursive: true, force: true });
    });
  });

  describe('Active Agent Display', () => {
    /**
     * @behavior Status line displays activeAgent when agent is executing
     * @acceptance-criteria Status line shows agent type and task when activeAgent is set
     * @business-rule Users should see which agent is currently working
     * @boundary Shell script (oss-statusline.sh) → workflow-state.json.activeAgent
     */
    it('should display activeAgent type when agent is executing', () => {
      // GIVEN: Workflow state has an active agent
      const projectState = {
        tddPhase: 'green',
        supervisor: 'intervening',
        activeAgent: {
          type: 'react-specialist',
          task: 'UserProfile component',
          startedAt: new Date().toISOString()
        }
      };
      fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show the agent type
      expect(output).toContain('react-specialist');
    });

    /**
     * @behavior Status line shows intervening indicator with active agent
     * @acceptance-criteria Status line shows ⚡ when supervisor is intervening
     */
    it('should show intervening indicator when agent is active', () => {
      // GIVEN: Workflow state has active agent and supervisor is intervening
      const projectState = {
        tddPhase: 'green',
        supervisor: 'intervening',
        activeAgent: {
          type: 'typescript-pro',
          task: 'Fix types',
          startedAt: new Date().toISOString()
        }
      };
      fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show ⚡ indicator for intervening
      expect(output).toContain('⚡');
    });
  });

  describe('Queue reading', () => {
    /**
     * @behavior Status line reads queue from project .oss/ when current-project set
     * @acceptance-criteria Queue count reflects project-specific queue
     */
    it('should read queue from project .oss/ when current-project set', () => {
      // GIVEN: Project has 2 critical tasks in queue
      const projectQueue = {
        tasks: [
          { status: 'pending', priority: 'critical', description: 'Task 1' },
          { status: 'pending', priority: 'critical', description: 'Task 2' }
        ]
      };
      fs.writeFileSync(projectQueueFile, JSON.stringify(projectQueue));

      // AND: Clear global queue to avoid interference
      if (fs.existsSync(globalQueueFile)) {
        fs.unlinkSync(globalQueueFile);
      }

      // AND: current-project points to test project
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // AND: Project has workflow state (so we can see the status line)
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ tddPhase: 'green' }));

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: testProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: testProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should show 2 tasks (from project) not 1 (from global)
      expect(output).toContain('🚨2');
    });
  });
});
