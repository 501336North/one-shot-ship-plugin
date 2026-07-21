/**
 * @behavior `oss-log.sh error` routes through the oss-error emitter so the project
 *           workflow.log receives a LogReader-parseable OSS_ERROR JSON line (one log
 *           dialect), while legacy plaintext session logging is preserved — and when
 *           the emitter is absent the hook falls back to legacy behavior, never failing.
 * @acceptance-criteria AC-007.1 — reconciled shell error path yields valid OSS_ERROR JSON
 * @business-rule US-007/ADR-006: shell errors and TypeScript errors speak one wire dialect
 *                so the watcher healing loop sees every error, whatever emitted it.
 * @boundary Shell script (hooks/oss-log.sh) + emitter dist (watcher/dist/cli/oss-error.js)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LogReader } from '../../src/logger/log-reader';

const REPO_ROOT = path.join(__dirname, '../../..');
const OSS_LOG_SCRIPT = path.join(REPO_ROOT, 'hooks/oss-log.sh');

interface Sandbox {
  home: string;
  projectDir: string;
  ossDir: string;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-emitter-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-emitter-proj-'));
  sandboxes.push(home, projectDir);
  const ossDir = path.join(projectDir, '.oss');
  fs.mkdirSync(ossDir, { recursive: true });
  return { home, projectDir, ossDir };
}

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Env pinned entirely into the sandbox — the real ~/.oss is never touched. */
function shellEnv(sandbox: Sandbox, pluginRoot: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    // oss-log.sh path validation requires TMPDIR when sandboxing under os.tmpdir()
    TMPDIR: os.tmpdir(),
    HOME: sandbox.home,
    CLAUDE_PROJECT_DIR: sandbox.projectDir,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  };
}

function runError(sandbox: Sandbox, pluginRoot: string, message: string): void {
  execFileSync('bash', [OSS_LOG_SCRIPT, 'error', 'build', message], {
    encoding: 'utf-8',
    env: shellEnv(sandbox, pluginRoot),
  });
}

describe('oss-log.sh error branch — emitter reconciliation (Task 10)', () => {
  it('should produce a LogReader-parseable OSS_ERROR line when oss-log.sh reports an error', async () => {
    // GIVEN — a sandboxed project and the emitter dist available via CLAUDE_PLUGIN_ROOT
    const sandbox = makeSandbox();
    const message = 'vitest exploded: 3 failed suites';

    // WHEN — the shell error path runs
    runError(sandbox, REPO_ROOT, message);

    // THEN — the project workflow.log carries a conformant OSS_ERROR line that the
    // real LogReader parses (same dialect the watcher pipeline consumes)
    const reader = new LogReader(sandbox.ossDir);
    const entries = await reader.readAll();
    const errorEntries = entries.filter((e) => e.event === 'OSS_ERROR');
    expect(errorEntries, 'exactly one OSS_ERROR line must reach workflow.log').toHaveLength(1);
    expect(errorEntries[0].data.message).toBe(message);
    expect(errorEntries[0].data.code).toBe('OSS-WORKFLOW-001');
    expect(errorEntries[0].data.source).toBe('hooks/oss-log.sh');

    // THEN — it is NOT the OSS-WORKFLOW-901 wrap: the line itself is schema-valid
    expect(errorEntries[0].data.code).not.toBe('OSS-WORKFLOW-901');
  });

  it('should fall back to legacy plaintext (never fail) when the emitter is absent', () => {
    // GIVEN — a plugin root with NO watcher/dist (emitter absent) and no plugin cache
    const sandbox = makeSandbox();
    const emptyPluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-emitter-empty-'));
    sandboxes.push(emptyPluginRoot);

    // WHEN — the shell error path runs (must not throw: exit code preserved at 0)
    runError(sandbox, emptyPluginRoot, 'legacy failure message');

    // THEN — the legacy plaintext ERROR line was written to the command log
    const commandLog = path.join(sandbox.ossDir, 'logs', 'current-session', 'build.log');
    expect(fs.existsSync(commandLog), 'legacy command log must exist').toBe(true);
    expect(fs.readFileSync(commandLog, 'utf-8')).toContain('[ERROR] legacy failure message');

    // THEN — no OSS_ERROR line was fabricated without the emitter
    const workflowLog = path.join(sandbox.ossDir, 'workflow.log');
    if (fs.existsSync(workflowLog)) {
      expect(fs.readFileSync(workflowLog, 'utf-8')).not.toContain('OSS_ERROR');
    }
  });
});
