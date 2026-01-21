/**
 * @behavior Session context is saved and restored from project-local .oss directory
 * @acceptance-criteria Multi-project sessions don't cross-contaminate context
 * @business-rule Each project has isolated session state
 * @boundary Shell hooks (oss-session-end.sh, oss-session-start.sh, oss-context-inject.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Session Context - Project Local Storage', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const sessionEndScript = path.join(hooksDir, 'oss-session-end.sh');
  const sessionStartScript = path.join(hooksDir, 'oss-session-start.sh');
  const contextInjectScript = path.join(hooksDir, 'oss-context-inject.sh');
  const globalOssDir = path.join(os.homedir(), '.oss');

  // Use unique test ID to avoid parallel test pollution
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let testProjectDir: string;
  let originalGlobalContext: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Create unique test project directory
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), `oss-context-local-${testId}-`));

    // Initialize as git repo (required by session hooks)
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
      // Create initial commit so git log works
      fs.writeFileSync(path.join(testProjectDir, 'README.md'), '# Test Project');
      execSync('git add .', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit"', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git init might fail in some environments
    }

    // Save original global context if it exists
    const globalContextFile = path.join(globalOssDir, 'session-context.md');
    if (fs.existsSync(globalContextFile)) {
      originalGlobalContext = fs.readFileSync(globalContextFile, 'utf-8');
    }

    // Save original current-project if exists
    const currentProjectFile = path.join(globalOssDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Ensure global .oss exists
    fs.mkdirSync(globalOssDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original global context
    const globalContextFile = path.join(globalOssDir, 'session-context.md');
    if (originalGlobalContext !== null) {
      fs.writeFileSync(globalContextFile, originalGlobalContext);
    } else if (fs.existsSync(globalContextFile)) {
      // Don't delete, just leave as is to avoid breaking other tests
    }

    // Restore original current-project
    const currentProjectFile = path.join(globalOssDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('oss-session-end.sh - Project Local Context Save', () => {
    /**
     * @behavior Session end saves context to project-local .oss/session-context.md
     * @acceptance-criteria Context saved to {project}/.oss/session-context.md, not global
     */
    it('should save session-context.md to project-local .oss directory', () => {
      // GIVEN: A test project directory with git initialized
      const projectOssDir = path.join(testProjectDir, '.oss');
      const projectContextFile = path.join(projectOssDir, 'session-context.md');

      // Ensure project .oss directory exists (simulating session-start ran first)
      fs.mkdirSync(projectOssDir, { recursive: true });

      // Record global context state before running
      const globalContextFile = path.join(globalOssDir, 'session-context.md');
      const globalContextBefore = fs.existsSync(globalContextFile)
        ? fs.readFileSync(globalContextFile, 'utf-8')
        : null;

      // WHEN: Running oss-session-end.sh from that project
      try {
        execSync(`bash "${sessionEndScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
            OSS_SKIP_WATCHER: '1',
          },
          cwd: testProjectDir,
        });
      } catch {
        // Script may exit non-zero for various reasons
      }

      // THEN: {project}/.oss/session-context.md exists
      expect(fs.existsSync(projectContextFile)).toBe(true);

      // AND: It contains expected content
      const projectContext = fs.readFileSync(projectContextFile, 'utf-8');
      expect(projectContext).toContain('## Restored Session Context');
      expect(projectContext).toContain('**Repository:**');

      // AND: Global context was NOT updated (or stayed the same)
      const globalContextAfter = fs.existsSync(globalContextFile)
        ? fs.readFileSync(globalContextFile, 'utf-8')
        : null;

      // If global context existed before, it should be unchanged
      // If it didn't exist, it should still not exist (or be unchanged from other tests)
      if (globalContextBefore !== null) {
        expect(globalContextAfter).toBe(globalContextBefore);
      }
    });
  });

  describe('oss-session-start.sh - Project Local Context Restore', () => {
    /**
     * @behavior Session start reads context from project-local .oss/session-context.md
     * @acceptance-criteria Restores context from current project, not from other projects
     */
    it('should read session-context.md from project-local .oss directory', () => {
      // GIVEN: Project has .oss/session-context.md with specific marker content
      const projectOssDir = path.join(testProjectDir, '.oss');
      const projectContextFile = path.join(projectOssDir, 'session-context.md');
      const uniqueMarker = `UNIQUE-PROJECT-MARKER-${testId}`;

      fs.mkdirSync(projectOssDir, { recursive: true });
      fs.writeFileSync(projectContextFile, `## Test Context\n**Marker:** ${uniqueMarker}\n`);

      // AND: Global context has DIFFERENT content
      const globalContextFile = path.join(globalOssDir, 'session-context.md');
      fs.writeFileSync(globalContextFile, '## Global Context\n**Marker:** GLOBAL-MARKER\n');

      // WHEN: Running oss-session-start.sh
      let output = '';
      try {
        output = execSync(`bash "${sessionStartScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
            OSS_SKIP_WATCHER: '1',
            OSS_SKIP_HEALTH_CHECK: '1',
          },
          cwd: testProjectDir,
        });
      } catch (e: unknown) {
        // Capture output even if script exits non-zero
        if (e && typeof e === 'object' && 'stdout' in e) {
          output = (e as { stdout: string }).stdout || '';
        }
      }

      // THEN: Output should reference "Previous session context restored"
      // (The actual context content is sent via notification, not stdout)
      expect(output).toContain('Previous session context restored');
    });
  });

  describe('oss-context-inject.sh - Project Local Context Inject', () => {
    /**
     * @behavior Context inject reads from project-local .oss/session-context.md
     * @acceptance-criteria UserPromptSubmit shows context from current project only
     */
    it('should inject session context from project-local path', () => {
      // GIVEN: Project has .oss/session-context.md with specific content
      const projectOssDir = path.join(testProjectDir, '.oss');
      const projectContextFile = path.join(projectOssDir, 'session-context.md');
      const uniqueMarker = `PROJECT-INJECT-MARKER-${testId}`;

      fs.mkdirSync(projectOssDir, { recursive: true });
      fs.writeFileSync(projectContextFile, `## Project Context\n**Marker:** ${uniqueMarker}\n`);

      // AND: Global context has DIFFERENT content
      const globalContextFile = path.join(globalOssDir, 'session-context.md');
      fs.writeFileSync(globalContextFile, '## Global Context\n**Marker:** GLOBAL-INJECT-MARKER\n');

      // Set current project so the script knows where to look
      fs.writeFileSync(path.join(globalOssDir, 'current-project'), testProjectDir);

      // WHEN: Running oss-context-inject.sh from that project
      let output = '';
      try {
        output = execSync(`bash "${contextInjectScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          },
          cwd: testProjectDir,
        });
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'stdout' in e) {
          output = (e as { stdout: string }).stdout || '';
        }
      }

      // THEN: Output contains the project-local marker, NOT global marker
      expect(output).toContain(uniqueMarker);
      expect(output).not.toContain('GLOBAL-INJECT-MARKER');
    });
  });
});

describe('Session Start - Auto .gitignore Setup', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const sessionStartScript = path.join(hooksDir, 'oss-session-start.sh');
  const globalOssDir = path.join(os.homedir(), '.oss');

  // Use unique test ID to avoid parallel test pollution
  const testId = `gitignore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let testProjectDir: string;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Create unique test project directory
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), `oss-gitignore-${testId}-`));

    // Initialize as git repo
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git init might fail in some environments
    }

    // Save original current-project if exists
    const currentProjectFile = path.join(globalOssDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Ensure global .oss exists
    fs.mkdirSync(globalOssDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original current-project
    const currentProjectFile = path.join(globalOssDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Session start adds .oss entries to existing .gitignore when creating .oss folder
   * @acceptance-criteria First-time .oss creation adds OSS entries to .gitignore
   */
  it('should add .oss entries to existing .gitignore when creating .oss folder', () => {
    // GIVEN: Project has .gitignore without .oss entries
    const gitignoreFile = path.join(testProjectDir, '.gitignore');
    fs.writeFileSync(gitignoreFile, 'node_modules/\n.env\n');

    // AND: Project does NOT have .oss folder
    const projectOssDir = path.join(testProjectDir, '.oss');
    expect(fs.existsSync(projectOssDir)).toBe(false);

    // WHEN: Running oss-session-start.sh
    // Note: Using cat | bash to avoid macOS virtualization file caching issues
    try {
      execSync(`cat "${sessionStartScript}" | bash`, {
        timeout: 30000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          OSS_SKIP_WATCHER: '1',
          OSS_SKIP_HEALTH_CHECK: '1',
        },
        cwd: testProjectDir,
        shell: '/bin/bash',
      });
    } catch {
      // Script may exit non-zero
    }

    // THEN: .gitignore contains OSS entries
    const gitignoreContent = fs.readFileSync(gitignoreFile, 'utf-8');
    expect(gitignoreContent).toContain('# OSS Dev Workflow (auto-added)');
    expect(gitignoreContent).toContain('.oss/*');
    expect(gitignoreContent).toContain('!.oss/dev/');

    // AND: Original content is preserved
    expect(gitignoreContent).toContain('node_modules/');
    expect(gitignoreContent).toContain('.env');
  });

  /**
   * @behavior Session start creates .gitignore with .oss entries when no .gitignore exists
   * @acceptance-criteria New .gitignore is created with OSS entries
   */
  it('should create .gitignore with .oss entries when no .gitignore exists', () => {
    // GIVEN: Project has no .gitignore
    const gitignoreFile = path.join(testProjectDir, '.gitignore');
    expect(fs.existsSync(gitignoreFile)).toBe(false);

    // AND: Project does NOT have .oss folder
    const projectOssDir = path.join(testProjectDir, '.oss');
    expect(fs.existsSync(projectOssDir)).toBe(false);

    // WHEN: Running oss-session-start.sh
    // Note: Using cat | bash to avoid macOS virtualization file caching issues
    try {
      execSync(`cat "${sessionStartScript}" | bash`, {
        timeout: 30000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          OSS_SKIP_WATCHER: '1',
          OSS_SKIP_HEALTH_CHECK: '1',
        },
        cwd: testProjectDir,
        shell: '/bin/bash',
      });
    } catch {
      // Script may exit non-zero
    }

    // THEN: .gitignore is created with OSS entries
    expect(fs.existsSync(gitignoreFile)).toBe(true);
    const gitignoreContent = fs.readFileSync(gitignoreFile, 'utf-8');
    expect(gitignoreContent).toContain('# OSS Dev Workflow (auto-added)');
    expect(gitignoreContent).toContain('.oss/*');
    expect(gitignoreContent).toContain('!.oss/dev/');
  });

  /**
   * @behavior Session start does NOT modify .gitignore if .oss already exists
   * @acceptance-criteria Existing .oss folder means no .gitignore modification
   */
  it('should NOT modify .gitignore if .oss already exists', () => {
    // GIVEN: Project already has .oss folder
    const projectOssDir = path.join(testProjectDir, '.oss');
    fs.mkdirSync(projectOssDir, { recursive: true });

    // AND: .gitignore does NOT have .oss entries
    const gitignoreFile = path.join(testProjectDir, '.gitignore');
    const originalContent = 'node_modules/\n';
    fs.writeFileSync(gitignoreFile, originalContent);

    // WHEN: Running oss-session-start.sh
    // Note: Using cat | bash to avoid macOS virtualization file caching issues
    try {
      execSync(`cat "${sessionStartScript}" | bash`, {
        timeout: 30000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          OSS_SKIP_WATCHER: '1',
          OSS_SKIP_HEALTH_CHECK: '1',
        },
        cwd: testProjectDir,
        shell: '/bin/bash',
      });
    } catch {
      // Script may exit non-zero
    }

    // THEN: .gitignore is NOT modified (folder already existed)
    const gitignoreContent = fs.readFileSync(gitignoreFile, 'utf-8');
    expect(gitignoreContent).toBe(originalContent);
  });

  /**
   * @behavior Session start does NOT duplicate .oss entries if already present
   * @acceptance-criteria No duplicate entries when .gitignore already has .oss
   */
  it('should NOT duplicate .oss entries if already present', () => {
    // GIVEN: Project has .gitignore WITH .oss entries
    const gitignoreFile = path.join(testProjectDir, '.gitignore');
    const existingContent = 'node_modules/\n.oss/*\n!.oss/dev/\n';
    fs.writeFileSync(gitignoreFile, existingContent);

    // AND: Project does NOT have .oss folder (first time setup scenario where user pre-added gitignore)
    const projectOssDir = path.join(testProjectDir, '.oss');
    expect(fs.existsSync(projectOssDir)).toBe(false);

    // WHEN: Running oss-session-start.sh
    // Note: Using cat | bash to avoid macOS virtualization file caching issues
    try {
      execSync(`cat "${sessionStartScript}" | bash`, {
        timeout: 30000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          OSS_SKIP_WATCHER: '1',
          OSS_SKIP_HEALTH_CHECK: '1',
        },
        cwd: testProjectDir,
        shell: '/bin/bash',
      });
    } catch {
      // Script may exit non-zero
    }

    // THEN: .gitignore does NOT have duplicate entries
    const gitignoreContent = fs.readFileSync(gitignoreFile, 'utf-8');
    const ossEntryCount = (gitignoreContent.match(/\.oss\/\*/g) || []).length;
    expect(ossEntryCount).toBe(1);
  });
});
