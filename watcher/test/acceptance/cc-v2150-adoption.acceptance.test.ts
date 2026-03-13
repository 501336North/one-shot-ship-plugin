/**
 * @behavior Claude Code v2.1.50 features are adopted into the OSS plugin
 * @acceptance-criteria AC-CC2150-001 through AC-CC2150-007
 * @business-rule Plugin leverages new CC capabilities for better isolation, UX, and safety
 * @boundary Plugin configuration files + shell scripts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const PLUGIN_ROOT = path.join(__dirname, '../../..');
const AGENTS_DIR = path.join(PLUGIN_ROOT, 'agents');
const HOOKS_DIR = path.join(PLUGIN_ROOT, 'hooks');

/** Simple YAML frontmatter parser (no external deps) */
function parseFrontmatter(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      const val = kv[2].trim();
      if (val === 'true') result[kv[1]] = true;
      else if (val === 'false') result[kv[1]] = false;
      else result[kv[1]] = val;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// AC-CC2150-001: Quality gate agents must NOT run in background (they're blocking gates)
// ---------------------------------------------------------------------------
describe('AC-CC2150-001: Quality gate agents are blocking', () => {
  const QUALITY_GATE_AGENTS = ['code-reviewer', 'performance-auditor', 'security-auditor'];
  const INTERACTIVE_AGENTS = ['debugger', 'docs-architect'];

  /**
   * @behavior Quality gate agents must be blocking — ship command waits for their results
   * @acceptance-criteria Quality gate agents do NOT have background: true in frontmatter
   */
  it('should NOT have background: true on quality gate agents (they are blocking gates)', () => {
    for (const agentName of QUALITY_GATE_AGENTS) {
      const agentFile = path.join(AGENTS_DIR, `${agentName}.md`);

      // GIVEN - the agent definition file exists
      expect(fs.existsSync(agentFile), `${agentName}.md should exist`).toBe(true);

      // WHEN - we parse its YAML frontmatter
      const frontmatter = parseFrontmatter(agentFile);

      // THEN - background should NOT be true (quality gates must block)
      expect(frontmatter.background, `${agentName} should NOT have background: true — it's a blocking quality gate`).not.toBe(true);
    }
  });

  /**
   * @behavior Interactive agents must NOT run in background
   * @acceptance-criteria Agents like debugger do not have background: true
   */
  it('should NOT have background: true on interactive agents', () => {
    for (const agentName of INTERACTIVE_AGENTS) {
      const agentFile = path.join(AGENTS_DIR, `${agentName}.md`);
      if (!fs.existsSync(agentFile)) continue;

      // WHEN - we parse its YAML frontmatter
      const frontmatter = parseFrontmatter(agentFile);

      // THEN - background should not be true
      expect(frontmatter.background, `${agentName} should NOT have background: true`).not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-002: Plugin ships settings.json with pre-approved tool patterns
// ---------------------------------------------------------------------------
describe('AC-CC2150-002: Plugin settings.json', () => {
  const SETTINGS_PATH = path.join(PLUGIN_ROOT, 'settings.json');

  /**
   * @behavior Plugin ships a valid settings.json that CC can parse
   * @acceptance-criteria File exists, is valid JSON, has permissions structure
   */
  it('should have valid settings.json with permissions', () => {
    // GIVEN - settings.json exists in plugin root
    expect(fs.existsSync(SETTINGS_PATH), 'settings.json should exist').toBe(true);

    // WHEN - we parse it
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);

    // THEN - it should have a permissions structure
    expect(settings).toHaveProperty('permissions');
  });

  /**
   * @behavior Common git commands are pre-approved to reduce permission prompts
   * @acceptance-criteria settings.json allows git status, add, commit, push, branch
   */
  it('should pre-approve standard git commands', () => {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    const permissions = JSON.stringify(settings.permissions);

    // THEN - git commands should be present in permissions
    expect(permissions).toContain('git');
  });

  /**
   * @behavior Test runner commands are pre-approved
   * @acceptance-criteria settings.json allows vitest, npm test, npm run
   */
  it('should pre-approve test and build commands', () => {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    const permissions = JSON.stringify(settings.permissions);

    expect(permissions).toMatch(/vitest|npm/);
  });

  /**
   * @behavior Destructive commands are NOT pre-approved
   * @acceptance-criteria settings.json does not allow git push --force, rm -rf
   */
  it('should NOT pre-approve destructive commands', () => {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const permissions = JSON.stringify(content);

    // THEN - dangerous patterns should not be pre-approved
    expect(permissions).not.toContain('--force');
    expect(permissions).not.toContain('rm -rf');
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-003: Minimum CC version check in session start
// ---------------------------------------------------------------------------
describe('AC-CC2150-003: CC version check', () => {
  const SESSION_START = path.join(HOOKS_DIR, 'oss-session-start.sh');

  /**
   * @behavior Session start checks CC version and warns if below 2.1.50
   * @acceptance-criteria Script contains version check logic
   */
  it('should contain version check logic in session start', () => {
    const content = fs.readFileSync(SESSION_START, 'utf-8');

    // THEN - session start should reference claude --version
    expect(content).toContain('claude --version');
    // AND should reference the minimum version
    expect(content).toMatch(/2\.1\.50|MIN_VERSION|MINIMUM_VERSION/);
  });

  /**
   * @behavior Version check warns on old CC versions
   * @acceptance-criteria Running with mocked old version produces warning output
   */
  it('should warn when CC version is below minimum', () => {
    const versionCheckScript = path.join(HOOKS_DIR, 'oss-version-check.sh');
    // Skip if helper script doesn't exist yet (will be created in build)
    if (!fs.existsSync(versionCheckScript)) {
      // Check inline in session-start instead
      const content = fs.readFileSync(SESSION_START, 'utf-8');
      expect(content).toMatch(/recommend|upgrade|warning/i);
      return;
    }

    // GIVEN - claude CLI returns an old version (via test override env var)
    const result = execSync(
      `bash "${versionCheckScript}" 2>&1 || true`,
      { encoding: 'utf-8', env: { ...process.env, OSS_TEST_CC_VERSION: '2.1.49' } }
    ).trim();

    // THEN - output should contain a warning
    expect(result).toMatch(/recommend|upgrade|warning/i);
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-004: Simple mode detection
// ---------------------------------------------------------------------------
describe('AC-CC2150-004: Simple mode detection', () => {
  const SESSION_START = path.join(HOOKS_DIR, 'oss-session-start.sh');

  /**
   * @behavior Session start detects CLAUDE_CODE_SIMPLE and warns
   * @acceptance-criteria Script checks CLAUDE_CODE_SIMPLE env var
   */
  it('should check for CLAUDE_CODE_SIMPLE in session start', () => {
    const content = fs.readFileSync(SESSION_START, 'utf-8');

    // THEN - should reference the simple mode env var
    expect(content).toContain('CLAUDE_CODE_SIMPLE');
  });

  /**
   * @behavior Simple mode produces a blocking warning
   * @acceptance-criteria When CLAUDE_CODE_SIMPLE=true, script exits with warning
   */
  it('should produce warning when CLAUDE_CODE_SIMPLE is set', () => {
    // GIVEN - CLAUDE_CODE_SIMPLE is set
    // We test by checking the script content for the warning pattern
    const content = fs.readFileSync(SESSION_START, 'utf-8');

    // THEN - should have both the check and the warning message
    expect(content).toMatch(/CLAUDE_CODE_SIMPLE/);
    expect(content).toMatch(/cannot function|disabled|breaks/i);
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-005: WorktreeCreate/WorktreeRemove hooks registered
// ---------------------------------------------------------------------------
describe('AC-CC2150-005: Worktree hook registration', () => {
  const HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks.json');

  /**
   * @behavior hooks.json registers WorktreeCreate handler
   * @acceptance-criteria hooks.json has WorktreeCreate key with command
   */
  it('should register WorktreeCreate hook', () => {
    const content = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf-8'));

    // THEN - WorktreeCreate should be registered
    expect(content.hooks).toHaveProperty('WorktreeCreate');
    expect(content.hooks.WorktreeCreate).toBeInstanceOf(Array);
    expect(content.hooks.WorktreeCreate.length).toBeGreaterThan(0);
  });

  /**
   * @behavior hooks.json registers WorktreeRemove handler
   * @acceptance-criteria hooks.json has WorktreeRemove key with command
   */
  it('should register WorktreeRemove hook', () => {
    const content = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf-8'));

    // THEN - WorktreeRemove should be registered
    expect(content.hooks).toHaveProperty('WorktreeRemove');
    expect(content.hooks.WorktreeRemove).toBeInstanceOf(Array);
    expect(content.hooks.WorktreeRemove.length).toBeGreaterThan(0);
  });

  /**
   * @behavior WorktreeCreate handler script exists and is executable
   * @acceptance-criteria oss-worktree-create.sh exists with +x permission
   */
  it('should have executable worktree-create script', () => {
    const scriptPath = path.join(HOOKS_DIR, 'oss-worktree-create.sh');

    // THEN - script should exist
    expect(fs.existsSync(scriptPath), 'oss-worktree-create.sh should exist').toBe(true);

    // AND - should be executable
    const stats = fs.statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable, 'oss-worktree-create.sh should be executable').toBe(true);
  });

  /**
   * @behavior WorktreeRemove handler script exists and is executable
   * @acceptance-criteria oss-worktree-remove.sh exists with +x permission
   */
  it('should have executable worktree-remove script', () => {
    const scriptPath = path.join(HOOKS_DIR, 'oss-worktree-remove.sh');

    // THEN - script should exist
    expect(fs.existsSync(scriptPath), 'oss-worktree-remove.sh should exist').toBe(true);

    // AND - should be executable
    const stats = fs.statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable, 'oss-worktree-remove.sh should be executable').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-006: ConfigChange hook guard
// ---------------------------------------------------------------------------
describe('AC-CC2150-006: ConfigChange guard', () => {
  const HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks.json');

  /**
   * @behavior hooks.json registers ConfigChange handler
   * @acceptance-criteria hooks.json has ConfigChange key with command
   */
  it('should register ConfigChange hook', () => {
    const content = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf-8'));

    // THEN - ConfigChange should be registered
    expect(content.hooks).toHaveProperty('ConfigChange');
    expect(content.hooks.ConfigChange).toBeInstanceOf(Array);
    expect(content.hooks.ConfigChange.length).toBeGreaterThan(0);
  });

  /**
   * @behavior ConfigChange handler script exists and is executable
   * @acceptance-criteria oss-config-change.sh exists with +x permission
   */
  it('should have executable config-change script', () => {
    const scriptPath = path.join(HOOKS_DIR, 'oss-config-change.sh');

    // THEN - script should exist
    expect(fs.existsSync(scriptPath), 'oss-config-change.sh should exist').toBe(true);

    // AND - should be executable
    const stats = fs.statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable, 'oss-config-change.sh should be executable').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-CC2150-007: build --team documents worktree isolation
// ---------------------------------------------------------------------------
describe('AC-CC2150-007: Build --team worktree isolation', () => {
  const BUILD_CMD = path.join(PLUGIN_ROOT, 'commands', 'build.md');

  /**
   * @behavior build.md documents worktree isolation for --team mode
   * @acceptance-criteria build.md mentions worktree/isolation in --team context
   */
  it('should document worktree isolation in build command', () => {
    const content = fs.readFileSync(BUILD_CMD, 'utf-8');

    // THEN - build command should mention worktree isolation
    expect(content).toMatch(/worktree|isolation/i);
    // AND - should be in context of --team flag
    expect(content).toContain('--team');
  });
});
