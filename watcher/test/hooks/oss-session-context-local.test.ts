/**
 * @behavior Session context is saved and restored from project-local .oss directory
 * @acceptance-criteria Multi-project sessions don't cross-contaminate context
 * @business-rule Each project has isolated session state
 * @boundary Shell hooks (oss-session-end.sh, oss-session-start.sh, oss-context-inject.sh)
 *
 * Hermetic: HOME is the per-file temp HOME from test/setup.ts. This file gives it a logged-in
 * OSS config with a FAKE apiKey and an apiUrl that points nowhere real, and puts a recording
 * `curl` stub first on every hook's PATH, so no hook here can reach the network.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './helpers/warm-stub';

const hooksDir = path.join(__dirname, '../../../hooks');
const sessionEndScript = path.join(hooksDir, 'oss-session-end.sh');
const sessionStartScript = path.join(hooksDir, 'oss-session-start.sh');
const contextInjectScript = path.join(hooksDir, 'oss-context-inject.sh');

// The sandbox world, all inside the temp HOME (os.homedir() is the temp HOME here).
const globalOssDir = path.join(os.homedir(), '.oss');
const stubBinDir = path.join(os.homedir(), 'stub-bin');
const curlStub = path.join(stubBinDir, 'curl');
const curlCallsFile = path.join(os.homedir(), 'curl-calls.log');
const SANDBOX_API_URL = 'http://127.0.0.1:9';
const REAL_API_HOST = 'one-shot-ship-api.onrender.com';

/** Env for every hook run: stub curl first on PATH, no live Claude session, test-mode switches on. */
function hookEnv(projectDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
    OSS_SKIP_WATCHER: '1',
    OSS_SKIP_HEALTH_CHECK: '1',
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

/** Runs a hook and returns its stdout, even when it exits non-zero. */
function runHook(script: string, projectDir: string): string {
  try {
    return execSync(`bash "${script}"`, {
      timeout: 30000,
      encoding: 'utf-8',
      env: hookEnv(projectDir),
      cwd: projectDir,
      shell: '/bin/bash',
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'stdout' in e) {
      return (e as { stdout: string }).stdout || '';
    }
    return '';
  }
}

/** One entry per curl call the stub saw: its argv. */
function recordedCurlCalls(): string[][] {
  if (!fs.existsSync(curlCallsFile)) return [];
  return fs
    .readFileSync(curlCallsFile, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\x1f').filter((arg) => arg.length > 0));
}

beforeAll(() => {
  // Logged in, with a key that is not a real key and an API URL nothing listens on.
  fs.mkdirSync(globalOssDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalOssDir, 'config.json'),
    JSON.stringify({ apiKey: 'oss_test_fake_key_not_real', apiUrl: SANDBOX_API_URL }),
  );

  // Recording curl stub: logs its argv, answers like an active subscription, never touches the network.
  // Warmed here, so the macOS first-exec scan of the new file is paid outside every test.
  writeWarmStub(
    curlStub,
    [
      `printf '%s\\x1f' "$@" >> "${curlCallsFile}"`,
      `printf '\\n' >> "${curlCallsFile}"`,
      `printf '%s' '{"status":"active"}'`,
      'exit 0',
    ].join('\n'),
  );
  fs.writeFileSync(curlCallsFile, '');
}, WARMUP_TIMEOUT_MS);

function makeGitProject(prefix: string, withCommit: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    if (withCommit) {
      fs.writeFileSync(path.join(dir, 'README.md'), '# Test Project');
      execSync('git add .', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'ignore' });
    }
  } catch {
    // Git init might fail in some environments
  }
  return dir;
}

describe('Session Context - Project Local Storage', () => {
  // Use unique test ID to avoid parallel test pollution
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let testProjectDir: string;

  beforeEach(() => {
    // Create unique test project directory, a git repo with one commit (required by session hooks)
    testProjectDir = makeGitProject(`oss-context-local-${testId}-`, true);
  });

  afterEach(() => {
    fs.rmSync(testProjectDir, { recursive: true, force: true });
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
      runHook(sessionEndScript, testProjectDir);

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

      // AND: There is NO global context (another test in this file may have left one), so only the
      // project file can make the hook report a restore. The restore message is the hook's only
      // stdout observable (branch and saveDate go to a notification that test mode skips).
      const globalContextFile = path.join(globalOssDir, 'session-context.md');
      fs.rmSync(globalContextFile, { force: true });

      // WHEN: Running oss-session-start.sh
      const output = runHook(sessionStartScript, testProjectDir);

      // THEN: Output should reference "Previous session context restored"
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
      const output = runHook(contextInjectScript, testProjectDir);

      // THEN: Output contains the project-local marker, NOT global marker
      expect(output).toContain(uniqueMarker);
      expect(output).not.toContain('GLOBAL-INJECT-MARKER');
    });
  });

  describe('Network isolation', () => {
    /**
     * @behavior Running the session hooks from this test file never reaches the network
     * @business-rule Tests never call the production API (no real traffic, no real-key dependency)
     */
    it('should make no network calls', () => {
      // GIVEN: A project with saved context and a clean curl record
      fs.writeFileSync(curlCallsFile, '');
      const projectOssDir = path.join(testProjectDir, '.oss');
      fs.mkdirSync(projectOssDir, { recursive: true });
      fs.writeFileSync(path.join(projectOssDir, 'session-context.md'), '## Test Context\n');

      // WHEN: Session start, context inject and session end run
      runHook(sessionStartScript, testProjectDir);
      runHook(contextInjectScript, testProjectDir);
      runHook(sessionEndScript, testProjectDir);

      // THEN: Every curl call (if any) went to the sandbox URL, and none named the real API host
      const calls = recordedCurlCalls();
      const offSandbox = calls.filter((argv) => !argv.some((arg) => arg.startsWith(SANDBOX_API_URL)));
      expect(offSandbox).toEqual([]);
      expect(calls.flat().join(' ')).not.toContain(REAL_API_HOST);
    });
  });
});

describe('Session Start - Auto .gitignore Setup', () => {
  // Use unique test ID to avoid parallel test pollution
  const testId = `gitignore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let testProjectDir: string;

  beforeEach(() => {
    // Create unique test project directory (git repo, no commit)
    testProjectDir = makeGitProject(`oss-gitignore-${testId}-`, false);
  });

  afterEach(() => {
    fs.rmSync(testProjectDir, { recursive: true, force: true });
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
    runHook(sessionStartScript, testProjectDir);

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
    runHook(sessionStartScript, testProjectDir);

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
    runHook(sessionStartScript, testProjectDir);

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
    runHook(sessionStartScript, testProjectDir);

    // THEN: .gitignore does NOT have duplicate entries
    const gitignoreContent = fs.readFileSync(gitignoreFile, 'utf-8');
    const ossEntryCount = (gitignoreContent.match(/\.oss\/\*/g) || []).length;
    expect(ossEntryCount).toBe(1);
  });
});
