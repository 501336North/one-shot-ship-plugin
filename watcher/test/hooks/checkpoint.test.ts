import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * @behavior Checkpoint system tracks build progress with metrics
 * @acceptance-criteria AC-CHECKPOINT-001
 * @business-rule Checkpoints enable progress tracking and delta comparison
 * @boundary Plugin hooks - checkpoint.sh
 */
describe('Checkpoint System', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const checkpointScript = path.join(hooksDir, 'checkpoint.sh');
  const testDir = path.join(__dirname, 'test-checkpoint-workspace');
  const featureName = 'test-feature';
  const checkpointsDir = path.join(testDir, '.oss', 'dev', 'active', featureName, 'checkpoints');

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

  describe('checkpoint.sh script', () => {
    it('should exist in hooks directory', () => {
      expect(fs.existsSync(checkpointScript)).toBe(true);
    });

    it('should be executable', () => {
      const stats = fs.statSync(checkpointScript);
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });
  });

  describe('checkpoint creation', () => {
    it('should create checkpoint directory structure', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "initial"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      expect(fs.existsSync(checkpointsDir)).toBe(true);
    });

    it('should create checkpoint JSON file with timestamp in filename', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "test-checkpoint"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFiles = files.filter(f => f.endsWith('.json'));
      expect(checkpointFiles.length).toBeGreaterThan(0);

      // File should have timestamp format: YYYYMMDD-HHMMSS-name.json
      const timestampPattern = /^\d{8}-\d{6}-.+\.json$/;
      expect(checkpointFiles.some(f => timestampPattern.test(f))).toBe(true);
    });
  });

  describe('checkpoint JSON schema', () => {
    it('should contain required fields: name, timestamp, git_sha', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "schema-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFile = files.find(f => f.endsWith('.json'));
      expect(checkpointFile).toBeDefined();

      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(checkpointsDir, checkpointFile!), 'utf-8')
      );

      expect(checkpoint).toHaveProperty('name');
      expect(checkpoint).toHaveProperty('timestamp');
      expect(checkpoint).toHaveProperty('git_sha');
      expect(checkpoint.name).toBe('schema-test');
      expect(typeof checkpoint.timestamp).toBe('string');
      expect(typeof checkpoint.git_sha).toBe('string');
    });

    it('should contain metrics object with files_changed, tests_total, tests_passing, coverage', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "metrics-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFile = files.find(f => f.endsWith('.json'));
      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(checkpointsDir, checkpointFile!), 'utf-8')
      );

      expect(checkpoint).toHaveProperty('metrics');
      expect(checkpoint.metrics).toHaveProperty('files_changed');
      expect(checkpoint.metrics).toHaveProperty('tests_total');
      expect(checkpoint.metrics).toHaveProperty('tests_passing');
      expect(checkpoint.metrics).toHaveProperty('coverage');
    });

    it('should contain tasks_completed field', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "tasks-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFile = files.find(f => f.endsWith('.json'));
      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(checkpointsDir, checkpointFile!), 'utf-8')
      );

      expect(checkpoint).toHaveProperty('tasks_completed');
      expect(typeof checkpoint.tasks_completed).toBe('number');
    });
  });

  describe('checkpoint storage location', () => {
    it('should store checkpoints in .oss/dev/active/{feature}/checkpoints/', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "location-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const expectedPath = path.join(testDir, '.oss', 'dev', 'active', featureName, 'checkpoints');
      expect(fs.existsSync(expectedPath)).toBe(true);

      const files = fs.readdirSync(expectedPath);
      expect(files.some(f => f.endsWith('.json'))).toBe(true);
    });
  });

  describe('metrics collection', () => {
    it('should collect files_changed from git status', () => {
      // Create a new file to show changed files
      fs.writeFileSync(path.join(testDir, 'new-file.ts'), 'export const x = 1;');

      execSync(`bash "${checkpointScript}" create "${featureName}" "files-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFile = files.find(f => f.endsWith('.json'));
      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(checkpointsDir, checkpointFile!), 'utf-8')
      );

      expect(checkpoint.metrics.files_changed).toBeGreaterThanOrEqual(1);
    });

    it('should capture git SHA correctly', () => {
      const gitSha = execSync('git rev-parse HEAD', { cwd: testDir, encoding: 'utf-8' }).trim();

      execSync(`bash "${checkpointScript}" create "${featureName}" "sha-test"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFile = files.find(f => f.endsWith('.json'));
      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(checkpointsDir, checkpointFile!), 'utf-8')
      );

      expect(checkpoint.git_sha).toBe(gitSha);
    });
  });

  describe('checkpoint comparison deltas', () => {
    it('should compare against previous checkpoint and show deltas', () => {
      // Create first checkpoint
      execSync(`bash "${checkpointScript}" create "${featureName}" "first"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      // Make changes
      fs.writeFileSync(path.join(testDir, 'another-file.ts'), 'export const y = 2;');
      fs.writeFileSync(path.join(testDir, 'third-file.ts'), 'export const z = 3;');

      // Create second checkpoint and capture output
      const output = execSync(`bash "${checkpointScript}" create "${featureName}" "second"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir },
        encoding: 'utf-8'
      });

      // Output should show deltas
      expect(output).toMatch(/files.*\+/i);
    });

    it('should show test delta when tests change', () => {
      // First checkpoint with initial state
      execSync(`bash "${checkpointScript}" create "${featureName}" "before-tests" --tests-total=5 --tests-passing=5`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      // Second checkpoint with more tests
      const output = execSync(`bash "${checkpointScript}" create "${featureName}" "after-tests" --tests-total=8 --tests-passing=8`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir },
        encoding: 'utf-8'
      });

      expect(output).toMatch(/tests.*\+3/i);
    });

    it('should show coverage delta when coverage changes', () => {
      // First checkpoint
      execSync(`bash "${checkpointScript}" create "${featureName}" "low-coverage" --coverage=60`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      // Second checkpoint with higher coverage
      const output = execSync(`bash "${checkpointScript}" create "${featureName}" "high-coverage" --coverage=80`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir },
        encoding: 'utf-8'
      });

      expect(output).toMatch(/coverage.*\+20%/i);
    });
  });

  describe('checkpoint cleanup (keeps last 10)', () => {
    it('should keep only the last 10 checkpoints per feature', () => {
      // Create 12 checkpoints
      for (let i = 1; i <= 12; i++) {
        execSync(`bash "${checkpointScript}" create "${featureName}" "checkpoint-${i}"`, {
          cwd: testDir,
          env: { ...process.env, OSS_DEV_ROOT: testDir }
        });
        // Small delay to ensure unique timestamps
        execSync('sleep 0.1');
      }

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFiles = files.filter(f => f.endsWith('.json'));

      expect(checkpointFiles.length).toBe(10);
    });

    it('should keep the most recent checkpoints when cleaning up', () => {
      // Create 12 checkpoints
      for (let i = 1; i <= 12; i++) {
        execSync(`bash "${checkpointScript}" create "${featureName}" "checkpoint-${i}"`, {
          cwd: testDir,
          env: { ...process.env, OSS_DEV_ROOT: testDir }
        });
        execSync('sleep 0.1');
      }

      const files = fs.readdirSync(checkpointsDir);
      const checkpointFiles = files.filter(f => f.endsWith('.json')).sort();

      // The oldest checkpoints (1, 2) should be removed
      // The newest checkpoints (3-12) should remain
      const checkpointNames = checkpointFiles.map(f => {
        const content = JSON.parse(fs.readFileSync(path.join(checkpointsDir, f), 'utf-8'));
        return content.name;
      });

      expect(checkpointNames).not.toContain('checkpoint-1');
      expect(checkpointNames).not.toContain('checkpoint-2');
      expect(checkpointNames).toContain('checkpoint-12');
    });
  });

  describe('list command', () => {
    it('should list all checkpoints for a feature', () => {
      // Create a few checkpoints
      execSync(`bash "${checkpointScript}" create "${featureName}" "first"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });
      execSync(`bash "${checkpointScript}" create "${featureName}" "second"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const output = execSync(`bash "${checkpointScript}" list "${featureName}"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir },
        encoding: 'utf-8'
      });

      expect(output).toContain('first');
      expect(output).toContain('second');
    });
  });

  describe('show command', () => {
    it('should show details of a specific checkpoint', () => {
      execSync(`bash "${checkpointScript}" create "${featureName}" "detailed"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir }
      });

      const output = execSync(`bash "${checkpointScript}" show "${featureName}" "detailed"`, {
        cwd: testDir,
        env: { ...process.env, OSS_DEV_ROOT: testDir },
        encoding: 'utf-8'
      });

      expect(output).toContain('detailed');
      expect(output).toMatch(/git_sha|sha/i);
      expect(output).toMatch(/metrics|files_changed/i);
    });
  });
});
