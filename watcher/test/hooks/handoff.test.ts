import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * @behavior Handoff system passes context between agents during build
 * @acceptance-criteria AC-HANDOFF-001
 * @business-rule Handoffs enable agent orchestration with full context
 * @boundary Plugin hooks - create-handoff.sh
 */
describe('Agent Handoff System', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const handoffScript = path.join(hooksDir, 'create-handoff.sh');
  const testDir = path.join(__dirname, 'test-handoff-workspace');
  const featureName = 'test-feature';
  const handoffsDir = path.join(testDir, '.oss', 'dev', 'active', featureName, 'handoffs');

  beforeEach(() => {
    // Create test workspace with git repo
    fs.mkdirSync(testDir, { recursive: true });
    execSync('git init', { cwd: testDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'ignore' });

    // Create initial commit
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Project');
    execSync('git add . && git commit -m "Initial commit"', { cwd: testDir, stdio: 'ignore' });
  });

  afterEach(() => {
    // Clean up test workspace
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('create-handoff.sh script', () => {
    it('should exist in hooks directory', () => {
      expect(fs.existsSync(handoffScript)).toBe(true);
    });

    it('should be executable', () => {
      const stats = fs.statSync(handoffScript);
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });
  });

  describe('handoff document creation', () => {
    it('should create handoffs directory structure', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      expect(fs.existsSync(handoffsDir)).toBe(true);
    });

    it('should create handoff markdown file with correct naming format', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFiles = files.filter(f => f.endsWith('.md'));
      expect(handoffFiles.length).toBeGreaterThan(0);

      // File should match format: handoff-{from}-to-{to}-{timestamp}.md
      const namingPattern = /^handoff-[\w-]+-to-[\w-]+-\d{8}-\d{6}\.md$/;
      expect(handoffFiles.some(f => namingPattern.test(f))).toBe(true);
    });
  });

  describe('handoff document required sections', () => {
    it('should contain Task Completed section', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      expect(handoffFile).toBeDefined();

      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');
      expect(content).toMatch(/### Task Completed/);
    });

    it('should contain Files Modified section', () => {
      // Create some modified files first
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src', 'api.ts'), 'export const api = {};');

      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toMatch(/### Files Modified/);
    });

    it('should contain Context for Next Agent section', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toMatch(/### Context for Next Agent/);
    });

    it('should contain Open Questions section', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toMatch(/### Open Questions/);
    });

    it('should have handoff header with from and to agents', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toMatch(/## Handoff: backend-architect.*test-engineer/);
    });
  });

  describe('files modified from git diff', () => {
    it('should populate Files Modified table from git status', () => {
      // Create and stage new files
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src', 'auth.ts'), 'export const auth = () => {};');
      fs.writeFileSync(path.join(testDir, 'src', 'user.ts'), 'export const user = {};');

      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      // Should contain table with files
      expect(content).toMatch(/\| File \| Changes \|/);
      expect(content).toMatch(/src\/auth\.ts/);
      expect(content).toMatch(/src\/user\.ts/);
    });

    it('should show line count changes for modified files', () => {
      // Modify an existing file
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Project\n\n## Overview\n\nThis is a test project.\n');
      execSync('git add README.md', { cwd: testDir, stdio: 'ignore' });

      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Updated README"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      // Should show line changes (e.g., +4 lines or similar)
      expect(content).toMatch(/README\.md.*\+?\d+/);
    });
  });

  describe('handoff storage location', () => {
    it('should store handoffs in .oss/dev/active/{feature}/handoffs/', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const expectedPath = path.join(testDir, '.oss', 'dev', 'active', featureName, 'handoffs');
      expect(fs.existsSync(expectedPath)).toBe(true);

      const files = fs.readdirSync(expectedPath);
      expect(files.some(f => f.endsWith('.md'))).toBe(true);
    });
  });

  describe('valid markdown output', () => {
    it('should produce valid markdown with proper table formatting', () => {
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src', 'api.ts'), 'export const api = {};');

      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      // Check markdown table has header separator
      expect(content).toMatch(/\|[-]+\|[-]+\|/);
    });

    it('should include timestamp in document', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "Completed API design"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      // Should contain a timestamp in ISO-like format
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('context and decisions', () => {
    it('should include task summary in Task Completed section', () => {
      const taskSummary = 'Completed API design with REST endpoints';
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "${taskSummary}"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toContain(taskSummary);
    });

    it('should support optional context flag for additional details', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "API design" --context="Used JWT for auth"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toContain('Used JWT for auth');
    });

    it('should support optional questions flag for open items', () => {
      execSync(`bash "${handoffScript}" "${featureName}" "backend-architect" "test-engineer" "API design" --questions="Should we add rate limiting?"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(handoffsDir);
      const handoffFile = files.find(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(handoffsDir, handoffFile!), 'utf-8');

      expect(content).toContain('Should we add rate limiting?');
    });
  });
});
