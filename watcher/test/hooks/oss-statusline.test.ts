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

    // Clean up test project with retry for race conditions
    const cleanupWithRetry = (dir: string, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          return;
        } catch (err) {
          if (i === retries - 1) {
            // Last retry, ignore error
            console.warn(`Warning: Could not clean up ${dir}: ${err}`);
          } else {
            // Wait briefly before retry
            const waitMs = 100 * (i + 1);
            const start = Date.now();
            while (Date.now() - start < waitMs) {
              // Busy wait
            }
          }
        }
      }
    };
    cleanupWithRetry(testProjectDir);
  });

  describe('Workflow state reading', () => {
    /**
     * @behavior Status line reads TDD phase from project .oss/ when current-project set
     * @acceptance-criteria Output contains project-specific TDD phase emoji (🔴)
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

      // THEN: Output should show 🔴 (from project) not 🟢 (from global)
      // Note: Emoji-only display (no "RED"/"GREEN" text)
      expect(output).toContain('🔴');
      expect(output).not.toContain('🟢');
    });

    /**
     * @behavior Status line falls back to global when no current-project set
     * @acceptance-criteria Output uses global state emoji when current-project is empty
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

      // THEN: Output should show 🟢 (from global)
      // Note: Emoji-only display
      expect(output).toContain('🟢');
    });

    /**
     * @behavior Status line falls back to global when project has no .oss/ state
     * @acceptance-criteria Output uses global state emoji when project .oss/ missing
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

      // THEN: Output should show 🟢 (from global fallback)
      // Note: Emoji-only display
      expect(output).toContain('🟢');
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

      // THEN: Output should show 🔴 (Project A), NOT 🟢 (Project B)
      // This proves we're using stdin's workspace.current_dir, not ~/.oss/current-project
      // Note: Emoji-only display (no "RED"/"GREEN" text)
      expect(output).toContain('🔴');
      expect(output).not.toContain('🟢');

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

  describe('Health-first ordering', () => {
    /**
     * @behavior Status line shows health indicator at the very beginning
     * @acceptance-criteria Health indicator (✅ or ⛔ LAW#X) appears BEFORE [Model]
     * @business-rule Health is the most important at-a-glance information
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should show health indicator at the beginning of the status line', () => {
      // GIVEN: Project has workflow state (no violations, so health should be ✅)
      const projectState = {
        tddPhase: 'green',
        supervisor: 'watching',
        currentCommand: 'build'
      };
      fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // AND: No iron law violations (so health is ✅)
      const ironLawFile = path.join(ossDir, 'iron-law-state.json');
      if (fs.existsSync(ironLawFile)) {
        fs.unlinkSync(ironLawFile);
      }

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

      // THEN: Output should START with health indicator, not [Model]
      // Target format: ✅ [Model] Dir | ...
      // Current format: [Model] Dir | ... ✅ ...
      expect(output.trim()).toMatch(/^✅/);
    });

    /**
     * @behavior Status line shows IRON LAW#4 violation when actually on main/master branch
     * @acceptance-criteria When on main branch, ⛔ LAW#4 appears BEFORE [Model]
     * @note LAW#4 is now checked DYNAMICALLY from git branch, not from state file
     */
    it('should show IRON LAW#4 violation when on main branch', () => {
      // GIVEN: Project is on main branch (LAW#4 violation)
      const law4ProjectDir = path.join(os.tmpdir(), `oss-law4-test-${Date.now()}`);
      fs.mkdirSync(path.join(law4ProjectDir, '.oss'), { recursive: true });

      // Initialize git repo on main branch
      try {
        execSync('git init', { cwd: law4ProjectDir, stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { cwd: law4ProjectDir, stdio: 'ignore' });
        execSync('git config user.name "Test User"', { cwd: law4ProjectDir, stdio: 'ignore' });
        // Stay on main/master (default after git init)
      } catch {
        // Git might fail in some environments
      }

      const law4WorkflowFile = path.join(law4ProjectDir, '.oss', 'workflow-state.json');
      const projectState = {
        tddPhase: 'green',
        supervisor: 'watching',
        currentCommand: 'build'
      };
      fs.writeFileSync(law4WorkflowFile, JSON.stringify(projectState));
      fs.writeFileSync(currentProjectFile, law4ProjectDir);

      // WHEN: Running statusline script
      const input = JSON.stringify({
        model: { display_name: 'Claude' },
        workspace: { current_dir: law4ProjectDir }
      });

      let output = '';
      try {
        output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
          timeout: 5000,
          encoding: 'utf-8',
          cwd: law4ProjectDir,
        });
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        output = execError.stdout || '';
      }

      // THEN: Output should START with violation indicator (LAW#4 for main branch)
      expect(output.trim()).toMatch(/^⛔ LAW#4/);

      // Cleanup
      fs.rmSync(law4ProjectDir, { recursive: true, force: true });
    });
  });

  describe('Enhanced queue display', () => {
    /**
     * @behavior Status line shows queue count AND top task name
     * @acceptance-criteria Format: 📋3: Implement auth (not just 📋3)
     * @business-rule Users should see what's next in queue at a glance
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should show queue count and top task description', () => {
      // GIVEN: Project has 3 pending tasks in queue
      const projectQueue = {
        tasks: [
          { status: 'pending', priority: 'normal', description: 'Implement auth' },
          { status: 'pending', priority: 'normal', description: 'Add validation' },
          { status: 'pending', priority: 'normal', description: 'Write tests' }
        ]
      };
      fs.writeFileSync(projectQueueFile, JSON.stringify(projectQueue));
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ tddPhase: 'green' }));
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

      // THEN: Output should show count AND description: "📋3: Implement auth"
      expect(output).toContain('📋3: Implement auth');
    });

    /**
     * @behavior Critical queue shows count AND top task name
     * @acceptance-criteria Format: 🚨2: Fix security bug (not just 🚨2)
     */
    it('should show critical queue count and top task description', () => {
      // GIVEN: Project has 2 critical tasks in queue
      const projectQueue = {
        tasks: [
          { status: 'pending', priority: 'critical', description: 'Fix security bug' },
          { status: 'pending', priority: 'critical', description: 'Patch auth' }
        ]
      };
      fs.writeFileSync(projectQueueFile, JSON.stringify(projectQueue));
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ tddPhase: 'green' }));
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

      // THEN: Output should show count AND description: "🚨2: Fix security bug"
      expect(output).toContain('🚨2: Fix security bug');
    });

    /**
     * @behavior Long task descriptions should be truncated
     * @acceptance-criteria Task names >20 chars are truncated with ellipsis
     */
    it('should truncate long task descriptions', () => {
      // GIVEN: Project has a task with a very long description
      const projectQueue = {
        tasks: [
          { status: 'pending', priority: 'normal', description: 'Implement the entire user authentication and authorization system with OAuth2' }
        ]
      };
      fs.writeFileSync(projectQueueFile, JSON.stringify(projectQueue));
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ tddPhase: 'green' }));
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

      // THEN: Task name should be truncated (not contain the full description)
      expect(output).not.toContain('OAuth2');
      // And should contain a truncated version with ellipsis
      expect(output).toMatch(/📋1: Implement the entire.{0,5}\.{3}/);
    });
  });

  describe('Message display', () => {
    /**
     * @behavior Status line shows message at end when set in workflow state
     * @acceptance-criteria Format: ... | 📣 Ideating
     * @business-rule Users should see non-sticky notifications in status line
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should display notification at end of status line (non-expired)', () => {
      // GIVEN: Workflow state has a notification set with future expiry
      const futureExpiry = new Date(Date.now() + 10000).toISOString();
      const projectState = {
        tddPhase: 'green',
        supervisor: 'watching',
        notification: {
          message: 'Building 3/10',
          expiresAt: futureExpiry
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

      // THEN: Output should contain the notification with emoji prefix
      expect(output).toContain('📣 Building 3/10');
    });

    /**
     * @behavior Status line shows no message when not set
     * @acceptance-criteria No 📣 section when message is empty/undefined
     */
    it('should not show message section when message is not set', () => {
      // GIVEN: Workflow state has no message
      const projectState = {
        tddPhase: 'green',
        supervisor: 'watching'
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

      // THEN: Output should NOT contain message emoji
      expect(output).not.toContain('📣');
    });
  });

  describe('Idle supervisor display', () => {
    /**
     * @behavior Status line shows nothing for idle supervisor (no redundant indicators)
     * @acceptance-criteria No supervisor indicator when 'idle' - redundancy removed
     * @business-rule Idle state is indicated by notification "Saved X ago" instead
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should NOT display 💾 when supervisor is idle (redundancy removed)', () => {
      // GIVEN: Workflow state has supervisor set to idle
      const projectState = {
        tddPhase: null,
        supervisor: 'idle',
        currentCommand: null
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

      // THEN: Output should NOT contain 💾 indicator (removed as redundant)
      expect(output).not.toContain('💾');
    });

    /**
     * @behavior Status line shows ✓ when supervisor is watching (not idle)
     * @acceptance-criteria ✓ indicator shown when supervisor is 'watching'
     */
    it('should display ✓ when supervisor is watching', () => {
      // GIVEN: Workflow state has supervisor set to watching
      const projectState = {
        tddPhase: 'green',
        supervisor: 'watching'
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

      // THEN: Output should contain ✓ indicator (not 💾)
      expect(output).toContain('✓');
      expect(output).not.toContain('💾');
    });
  });

  describe('Minimal idle state display', () => {
    /**
     * @behavior Idle state shows minimal info: health + branch + suggested next
     * @acceptance-criteria When idle (no currentCommand, no activeAgent, no tddPhase),
     *                      status line shows only: ✅ 🌿 branch → nextCommand
     * @business-rule When user is not actively in a workflow, reduce noise
     * @boundary Shell script (oss-statusline.sh)
     */
    it('should show minimal display in idle state: health + branch + next command', () => {
      // GIVEN: Workflow state is idle (no active work)
      const projectState = {
        supervisor: 'idle',
        nextCommand: 'plan'
        // No currentCommand, no activeAgent, no tddPhase
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

      // THEN: Output should contain key sections
      // Should contain: health (✅), [Model] project, branch (🌿 feat/test-branch), next command (→ plan)
      expect(output).toContain('✅');
      expect(output).toContain('[Claude]');  // Model always shown (including idle)
      expect(output).toContain('🌿');
      expect(output).toContain('→ plan');
    });

    /**
     * @behavior Idle state without nextCommand shows health + Model + branch
     * @acceptance-criteria When idle and no nextCommand, show: ✅ [Model] project 🌿 branch
     */
    it('should show health + Model + branch when idle with no nextCommand', () => {
      // GIVEN: Workflow state is idle with no nextCommand
      const projectState = {
        supervisor: 'idle'
        // No currentCommand, no activeAgent, no tddPhase, no nextCommand
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

      // THEN: Output should contain health, Model, and branch
      expect(output).toContain('✅');
      expect(output).toContain('[Claude]');  // Model always shown (including idle)
      expect(output).toContain('🌿');
      // Should NOT contain arrow (no nextCommand)
      expect(output).not.toContain('→');
    });

    /**
     * @behavior Active workflow shows full status (not minimal)
     * @acceptance-criteria When currentCommand is set, show full status including [Model]
     */
    it('should show full status when in active workflow (not idle)', () => {
      // GIVEN: Workflow state has active command
      const projectState = {
        supervisor: 'watching',
        currentCommand: 'build',
        tddPhase: 'red',
        progress: '3/8'
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

      // THEN: Output should show full status including [Model]
      expect(output).toContain('[Claude]');
      expect(output).toContain('🔴');
    });
  });
});
