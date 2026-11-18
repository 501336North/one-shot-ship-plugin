/**
 * @behavior On macOS, every main-agent or builder Bash call is sent back rewritten to run under an OS
 *   write-deny sandbox (sandbox-exec), with Claude Code's own permission checks kept (no auto-allow).
 *   The OS then refuses writes to code-run and gate-config paths (git hooks, git config, ~/.oss/hooks,
 *   ~/.claude.json) however the shell text hides them, while ordinary project writes still work.
 *   Git-only and OSS-only calls are wrapped too, with a small allowance (the repo's .git/config for
 *   git). Where the write sandbox can't be used (Linux, a failed self-test, Claude Code's managed
 *   sandbox not covering the deny set), the call runs under today's text rules with one notice per
 *   session. Review agents keep today's review sandbox.
 * @business-rule write-sandbox US-001..US-005, ADR-070 (wrap), ADR-071 (deny set), ADR-072 (narrowed
 *   loosening inside the wrap), ADR-074 and PLAN_GATE.md D1 (git-only/OSS-only wrapped), D2 (widened
 *   deny set), D3 (updatedInput without allow), D4 (managed settings only, no loosening).
 * @boundary runToolGate (gate.ts) with a PreToolUse Bash request, a scratch HOME and a scratch git
 *   repo per test; the macOS rows run the returned command for real under /usr/bin/sandbox-exec.
 *
 * Injection note (not yet in GateDeps): the builder containment's self-test is driven through the
 * existing `sandbox.run` runner (the most natural extension: one SandboxRunner for both the review and
 * the write-deny self-test). `platform` and `sandbox.settingsHomes` are reused as they are today.
 * `sandbox.managedSettings` does NOT exist yet: today hostSandboxOn reads a fixed MANAGED_SETTINGS
 * path. These tests pass a managed-settings file path through it (the natural extension of
 * `settingsHomes`, see WriteSandboxDeps); every test points it at a scratch file, never the real one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ON_MAC = process.platform === 'darwin';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const BUILDER = 'oss:typescript-pro';
const MAIN_AGENT = undefined;
const AGENTS: ReadonlyArray<{ name: string; agent: string | undefined }> = [
  { name: 'the main agent', agent: MAIN_AGENT },
  { name: 'a builder (oss:typescript-pro)', agent: BUILDER },
];

interface Case {
  root: string;
  home: string;
  repo: string;
  tmp: string;
  userTemp: string;
  session: string;
}

/** GateDeps plus the not-yet-existing managed-settings path override (D4, Task 5). */
type WriteSandboxDeps = GateDeps & { sandbox?: NonNullable<GateDeps['sandbox']> & { managedSettings?: string } };

let counter = 0;
let c: Case;

/** A fresh scratch HOME, repo, TMPDIR and user temp folder, and a unique session, for each test. */
function newCase(): Case {
  counter += 1;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-wsbx-accept-')));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  const tmp = path.join(root, 'tmp');
  const userTemp = path.join(root, 'usertemp');
  for (const dir of [home, repo, tmp, path.join(home, '.oss', 'hooks')]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(userTemp, { mode: 0o700 });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return { root, home, repo, tmp, userTemp, session: `wsbx-${process.pid}-${Date.now()}-${counter}` };
}

beforeEach(() => {
  c = newCase();
});

afterEach(() => {
  fs.rmSync(c.root, { recursive: true, force: true });
});

function bashCall(command: string, agent: string | undefined): string {
  return JSON.stringify({
    session_id: c.session,
    cwd: c.repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command, description: 'work', timeout: 60000, run_in_background: false },
    ...(agent === undefined ? {} : { agent_type: agent, agent_id: 'a1' }),
  });
}

/** Runs the gate at its boundary, with only scratch places and a clean hook environment. */
async function gate(command: string, agent: string | undefined, deps: WriteSandboxDeps = {}): Promise<GateResult> {
  const sandbox: NonNullable<WriteSandboxDeps['sandbox']> = {
    userTemp: c.userTemp,
    passwordHome: c.home,
    settingsHomes: [c.home],
    managedSettings: managedSettingsPath(),
    ...deps.sandbox,
  };
  const all: WriteSandboxDeps = { ...deps, sandbox };
  return runToolGate(
    {
      mode: 'pre',
      input: bashCall(command, agent),
      env: { HOME: c.home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: c.repo, TMPDIR: c.tmp },
      hookEnv: { HOME: c.home, PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: c.tmp, USER: os.userInfo().username },
    },
    all,
  );
}

/** The scratch managed-settings file (absent unless a test writes it). */
function managedSettingsPath(): string {
  return path.join(c.root, 'managed', 'managed-settings.json');
}

interface HookOutput {
  permissionDecision?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}

function hookOutput(result: GateResult): HookOutput | null {
  if (result.stdout.trim() === '') return null;
  const parsed = JSON.parse(result.stdout) as { hookSpecificOutput?: HookOutput };
  return parsed.hookSpecificOutput ?? null;
}

/**
 * The rewritten command when the call was sent back wrapped; null when it was not rewritten.
 * D3: a wrapped builder/main-agent call keeps Claude Code's own checks, so it carries no
 * permissionDecision at all (never 'allow').
 */
function wrappedCommand(result: GateResult): string | null {
  const out = hookOutput(result);
  if (out?.updatedInput === undefined) return null;
  expect(out.permissionDecision).toBeUndefined();
  return String(out.updatedInput.command);
}

/** The one notice line saying the write sandbox is off, wherever the gate put it; null when none. */
function notice(result: GateResult): string | null {
  const out = hookOutput(result);
  const text = [out?.additionalContext ?? '', result.stderr].join('\n');
  return text.split('\n').find((line) => /write sandbox/i.test(line)) ?? null;
}

/** Runs a rewritten call the way Claude Code's shell would, in the scratch repo and HOME. */
function runWrapped(command: string): { status: number | null; out: string } {
  const run = spawnSync('/bin/bash', ['-c', command], {
    cwd: c.repo,
    encoding: 'utf8',
    timeout: 60_000,
    env: { HOME: c.home, PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: c.tmp },
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

const hookFile = (name: string): string => path.join(c.repo, '.git', 'hooks', name);

/**
 * A node one-liner that writes `data` to `target` (relative to the cwd, or to HOME with `fromHome`),
 * with the target base64-encoded so the text gate can't read it: only the OS can stop it.
 */
function hiddenWrite(target: string, data: string, how: 'write' | 'append' = 'write', fromHome = false): string {
  const name = `Buffer.from('${Buffer.from(target).toString('base64')}','base64').toString()`;
  const full = fromHome ? `require('os').homedir()+'/'+${name}` : name;
  return `node -e "require('fs').${how === 'write' ? 'writeFileSync' : 'appendFileSync'}(${full},'${data}')"`;
}

// ---------------------------------------------------------------------------------------------
// US-001: the OS refuses protected-path writes (macOS)
// ---------------------------------------------------------------------------------------------
describe.runIf(ON_MAC)('US-001: a mixed call runs under the OS write-deny sandbox (macOS)', () => {
  for (const { name, agent } of AGENTS) {
    /**
     * @behavior A write to a git hook the gate can't read (inline code) is refused by macOS, and a
     *   project write in the same call works.
     * @user-story US-001 (AC-001.1, AC-001.2)
     */
    it(`${name}: given a mixed call writing .git/hooks/pre-commit through base64-hidden inline code, when the gate sends it back wrapped and it runs, then the hook is absent and the project file is written`, async () => {
      // Given
      const command = `npm -v >/dev/null 2>&1; ${hiddenWrite('.git/hooks/pre-commit', 'x')}; echo ok > notes.txt`;

      // When
      const result = await gate(command, agent);
      const wrapped = wrappedCommand(result);

      // Then
      expect(result.exitCode).toBe(0);
      expect(hookOutput(result)?.permissionDecision).toBeUndefined();
      expect(wrapped).not.toBeNull();
      expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
      runWrapped(String(wrapped));
      expect(fs.existsSync(hookFile('pre-commit'))).toBe(false);
      expect(fs.readFileSync(path.join(c.repo, 'notes.txt'), 'utf8')).toBe('ok\n');
    });

    /**
     * @behavior A disguised `${TMPDIR:-.git/hooks}` write (target unreadable to the text gate,
     *   readable last part `post-checkout`) is allowed wrapped, and the OS refuses it.
     * @user-story US-001 (AC-001.1), US-002 (AC-002.3)
     */
    it(`${name}: given a disguised fallback write into .git/hooks, when the gate sends it back wrapped and it runs, then post-checkout is absent`, async () => {
      // Given
      const command = `d=\${TMPDIR:-.git/hooks}; TMPDIR= ; echo x > "\${TMPDIR:-.git/hooks}/post-checkout"; echo ok > notes.txt`;

      // When
      const result = await gate(command, agent);
      const wrapped = wrappedCommand(result);

      // Then
      expect(result.exitCode).toBe(0);
      expect(hookOutput(result)?.permissionDecision).toBeUndefined();
      expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
      runWrapped(String(wrapped));
      expect(fs.existsSync(hookFile('post-checkout'))).toBe(false);
      expect(fs.readFileSync(path.join(c.repo, 'notes.txt'), 'utf8')).toBe('ok\n');
    });

    /**
     * @behavior Git config and ~/.oss/hooks writes the gate can't read are refused by macOS.
     * @user-story US-001 (AC-001.1, AC-001.3)
     */
    it(`${name}: given a mixed call writing .git/config and ~/.oss/hooks through base64-hidden inline code, when it runs wrapped, then both are unchanged`, async () => {
      // Given
      const gitConfig = path.join(c.repo, '.git', 'config');
      const before = fs.readFileSync(gitConfig, 'utf8');
      const planted = path.join(c.home, '.oss', 'hooks', 'evil.sh');
      const command =
        `npm -v >/dev/null 2>&1; ${hiddenWrite('.git/config', '[core] hooksPath = /tmp/x', 'append')}; ` +
        `${hiddenWrite('.oss/hooks/evil.sh', 'x', 'write', true)}; echo ok > notes.txt`;

      // When
      const result = await gate(command, agent);
      const wrapped = wrappedCommand(result);

      // Then
      expect(result.exitCode).toBe(0);
      expect(hookOutput(result)?.permissionDecision).toBeUndefined();
      expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
      runWrapped(String(wrapped));
      expect(fs.readFileSync(gitConfig, 'utf8')).toBe(before);
      expect(fs.existsSync(planted)).toBe(false);
      expect(fs.readFileSync(path.join(c.repo, 'notes.txt'), 'utf8')).toBe('ok\n');
    });
  }

  /**
   * @behavior The widened deny set (D2) covers ~/.claude.json: a hidden write to it is refused by
   *   the OS, and the wrapped call carries no auto-allow (D3).
   * @user-story US-001 (AC-001.1), D2, D3
   */
  it('given the main agent, when a mixed call writes ~/.claude.json through base64-hidden inline code and runs wrapped, then the file is not created', async () => {
    // Given
    const target = path.join(c.home, '.claude.json');
    const command = `npm -v >/dev/null 2>&1; ${hiddenWrite('.claude.json', '{}', 'write', true)}; echo ok > notes.txt`;

    // When
    const result = await gate(command, MAIN_AGENT);
    const wrapped = wrappedCommand(result);

    // Then
    expect(result.exitCode).toBe(0);
    expect(hookOutput(result)?.permissionDecision).toBeUndefined();
    expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    runWrapped(String(wrapped));
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(c.repo, 'notes.txt'), 'utf8')).toBe('ok\n');
  });
});

// ---------------------------------------------------------------------------------------------
// US-003 / D1 (ADR-074): git-only and OSS-only calls are wrapped too, with a small allowance
// ---------------------------------------------------------------------------------------------
describe('US-003 / D1: git-only and OSS-only calls are wrapped too, with their allowance', () => {
  /** Injected macOS and a passing self-test (F11: decision rows inject platform and runner). */
  const MAC_OK: WriteSandboxDeps = { platform: 'darwin', sandbox: { run: () => true } };

  for (const { name, agent } of AGENTS) {
    /**
     * @behavior A call made only of git commands is sent back wrapped (D1), so a hook write hidden
     *   behind git is still stopped by the OS.
     * @user-story US-003 (AC-003.1 as revised by D1)
     */
    it(`${name}: given a git-only call on macOS, when the gate checks it, then it is sent back wrapped under sandbox-exec`, async () => {
      // Given / When
      const result = await gate('git status && git log -1', agent, MAC_OK);

      // Then
      expect(result.exitCode).toBe(0);
      expect(String(wrappedCommand(result)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    });

    /**
     * @behavior A call made only of OSS hook scripts is sent back wrapped (D1), with only the OSS
     *   state files those scripts write allowed.
     * @user-story US-003, ADR-074 (D1)
     */
    it(`${name}: given an OSS-only call on macOS, when the gate checks it, then it is sent back wrapped under sandbox-exec`, async () => {
      // Given / When
      const result = await gate('~/.oss/hooks/oss-log.sh write build x', agent, MAC_OK);

      // Then
      expect(result.exitCode).toBe(0);
      expect(String(wrappedCommand(result)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    });
  }
});

describe.runIf(ON_MAC)('US-003 / D1: git keeps working inside the git-only wrap (macOS, real sandbox-exec)', () => {
  /** Makes one commit in the scratch repo (setup, outside the gate). */
  function commitOnce(): void {
    fs.writeFileSync(path.join(c.repo, 'pre-commit'), '#!/bin/sh\necho planted\n');
    const id = ['-c', 'user.name=t', '-c', `user.email=t-${c.session}@example.com`];
    execFileSync('git', [...id, 'add', '.'], { cwd: c.repo });
    execFileSync('git', [...id, 'commit', '-qm', 'init'], { cwd: c.repo });
  }

  /**
   * @behavior `git remote add` then `git push -u` (each its own git-only call, as the text rules
   *   require) succeed wrapped: the git-only profile allows the project repo's .git/config.
   * @user-story US-003 (AC-003.1), D1
   */
  it('given a repo with a commit and a bare remote, when the main agent adds the remote and pushes -u through the gate, then both wrapped calls succeed and the upstream is recorded', async () => {
    // Given
    commitOnce();
    const bare = path.join(c.root, `remote-${c.session}.git`);
    execFileSync('git', ['init', '-q', '--bare', bare]);

    // When
    const add = await gate(`git remote add o '${bare}'`, MAIN_AGENT);
    const addRun = runWrapped(String(wrappedCommand(add)));
    const push = await gate('git push -u o HEAD', MAIN_AGENT);
    const pushRun = runWrapped(String(wrappedCommand(push)));

    // Then
    expect(String(wrappedCommand(add)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    expect(addRun.status, addRun.out).toBe(0);
    expect(String(wrappedCommand(push)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    expect(pushRun.status, pushRun.out).toBe(0);
    expect(execFileSync('git', ['config', 'branch.feat/x.remote'], { cwd: c.repo, encoding: 'utf8' }).trim()).toBe('o');
    expect(execFileSync('git', ['rev-parse', 'refs/heads/feat/x'], { cwd: bare, encoding: 'utf8' }).trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  /**
   * @behavior A git-only call whose work tree becomes a link into .git/hooks after the gate checked
   *   it (a swap the text rules can't see) can't plant a hook: the OS refuses the write.
   *   Note: the coordinator's `git -c core.hooksPath=h …` shape is refused by today's text rules
   *   (the git reader), which stay, so the OS proof uses a work-tree swap instead.
   * @user-story US-001 (AC-001.1), US-003, D1
   */
  it('given a git-only checkout into a work-tree folder, when that folder is swapped for a link into .git/hooks before the wrapped call runs, then no hook is written', async () => {
    // Given
    commitOnce();
    fs.mkdirSync(path.join(c.repo, 'wt'));

    // When
    const result = await gate('git --work-tree=wt checkout HEAD -- pre-commit', MAIN_AGENT);
    const wrapped = wrappedCommand(result);
    fs.rmSync(path.join(c.repo, 'wt'), { recursive: true });
    fs.symlinkSync(path.join(c.repo, '.git', 'hooks'), path.join(c.repo, 'wt'));
    runWrapped(String(wrapped));

    // Then
    expect(result.exitCode).toBe(0);
    expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
    expect(fs.existsSync(hookFile('pre-commit'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Review agents: unchanged (regression guard, may already pass)
// ---------------------------------------------------------------------------------------------
describe.runIf(ON_MAC)("review agents keep today's review sandbox (regression guard)", () => {
  /**
   * @behavior A review agent's call is still allowed rewritten into the review sandbox, with every
   *   other input field kept. REGRESSION GUARD: this already passes today and must keep passing.
   * @user-story Out of scope: "changes to review agents' sandbox" (REQUIREMENTS.md)
   */
  it("given a review agent's read, when the gate checks it, then the decision shape is today's: allow with a sandbox-exec rewrite", async () => {
    // Given / When
    const result = await gate('git status --short', 'oss:code-reviewer');
    const out = hookOutput(result);

    // Then
    expect(result.exitCode).toBe(0);
    expect(out?.permissionDecision).toBe('allow');
    expect(String(out?.updatedInput?.command)).toMatch(/^\/usr\/bin\/sandbox-exec -p '/);
    expect(out?.updatedInput).toMatchObject({ description: 'work', timeout: 60000, run_in_background: false });
    expect(out?.additionalContext).toMatch(/review sandbox/);
  });
});

// ---------------------------------------------------------------------------------------------
// US-004: safe fallback with one notice per session
// ---------------------------------------------------------------------------------------------
describe('US-004: where the write sandbox is off, text rules apply with one notice per session', () => {
  const MIXED = 'npm -v >/dev/null 2>&1; echo ok > notes.txt';

  /**
   * @behavior On Linux the call is not rewritten, and the session is told once that the write
   *   sandbox is off and why.
   * @user-story US-004 (AC-004.1, AC-004.2)
   */
  it('given Linux, when the main agent makes two mixed calls in one session, then neither is rewritten and only the first carries the notice', async () => {
    // Given
    const deps: GateDeps = { platform: 'linux' };

    // When
    const first = await gate(MIXED, MAIN_AGENT, deps);
    const second = await gate(MIXED, MAIN_AGENT, deps);

    // Then
    expect(first.exitCode).toBe(0);
    expect(hookOutput(first)?.updatedInput).toBeUndefined();
    const line = notice(first);
    expect(line).not.toBeNull();
    expect(line).toMatch(/\boff\b/i);
    expect(line).toMatch(/linux/i);
    expect(second.exitCode).toBe(0);
    expect(hookOutput(second)?.updatedInput).toBeUndefined();
    expect(notice(second)).toBeNull();
  });

  /**
   * @behavior When the sandbox self-test fails, the builder's call is not rewritten (never bricked),
   *   with one notice naming the failed self-test.
   * @user-story US-004 (AC-004.1, AC-004.2)
   */
  it('given macOS with a failing containment self-test, when a builder makes two mixed calls, then neither is rewritten and only the first carries the notice', async () => {
    // Given: the self-test runner fails (the existing sandbox.run seam, see the header note)
    const deps: GateDeps = { platform: 'darwin', sandbox: { run: () => false } };

    // When
    const first = await gate(MIXED, BUILDER, deps);
    const second = await gate(MIXED, BUILDER, deps);

    // Then
    expect(first.exitCode).toBe(0);
    expect(hookOutput(first)?.updatedInput).toBeUndefined();
    const line = notice(first);
    expect(line).not.toBeNull();
    expect(line).toMatch(/\boff\b/i);
    expect(line).toMatch(/self-test/i);
    expect(notice(second)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// US-002 / ADR-072: narrowed loosening inside the wrap (macOS)
// ---------------------------------------------------------------------------------------------
describe.runIf(ON_MAC)('US-002 / ADR-072: inside the wrap, unreadable targets are allowed only when they cannot name a text-only file', () => {
  /**
   * @behavior The `mktemp` TMPDIR fallback, over-refused today, is allowed and wrapped.
   * @user-story US-002 (AC-002.1)
   */
  it('given the main agent, when it runs mktemp with a ${TMPDIR:-/tmp} fallback, then the call is allowed wrapped', async () => {
    // Given / When
    const result = await gate('mktemp "${TMPDIR:-/tmp}/x.XXXXXX"', MAIN_AGENT);

    // Then
    expect(result.exitCode).toBe(0);
    expect(String(wrappedCommand(result)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  });

  /**
   * @behavior A disguised write whose readable last part is a protected branch is still refused,
   *   because refs are not OS-denied. NOTE: today's text gate ALLOWS this call (found while writing
   *   this test), so it fails now and the ADR-072 work must close it.
   * @user-story US-002 (AC-002.3)
   */
  it('given the main agent, when it writes "$x/main" with x defaulting to .git/refs/heads, then the call is refused', async () => {
    // Given / When
    const result = await gate('x=${R:-.git/refs/heads}; echo > "$x/main"', MAIN_AGENT);

    // Then
    expect(result.exitCode).toBe(2);
  });

  /**
   * @behavior A fully unreadable target (an array) stays refused. Regression guard: refused today too.
   * @user-story US-002 (AC-002.3), ADR-069
   */
  it('given the main agent, when it removes an array of files, then the call is refused', async () => {
    // Given / When
    const result = await gate('files=(a b); rm $files', MAIN_AGENT);

    // Then
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// US-005 / D4: only Claude Code's MANAGED sandbox settings count as the OS layer
// ---------------------------------------------------------------------------------------------
describe("US-005 / D4: only Claude Code's managed sandbox settings count as the OS layer", () => {
  /** The OS deny set (AC-001.3, ADR-073, D2) in Claude Code's denyWrite path spelling. Task 5 fixes the exact accepted spelling. */
  const DENY_SET = [
    '**/.git/hooks/**',
    '**/.git/config',
    '**/.git/config.worktree',
    '**/.git/worktrees/*/config.worktree',
    '**/.git/modules/**/config',
    '~/.gitconfig',
    '~/.config/git/config',
    '.claude/**',
    '.mcp.json',
    '~/.claude/**',
    '~/.claude.json',
    '~/Library/LaunchAgents/**',
    '~/.zshenv',
    '~/.zshrc',
    '~/.zprofile',
    '~/.bashrc',
    '~/.bash_profile',
    '~/.profile',
    '~/.oss/**',
    '.oss/tool-gates.json',
    '.oss/tool-gates/**',
    '**/.oss/dev/active/*/results/**',
    '**/.oss/dev/completed/*/results/**',
  ];
  /** Injected macOS and a passing self-test (F11). */
  const MAC_OK: WriteSandboxDeps = { platform: 'darwin', sandbox: { run: () => true } };
  const MKTEMP_FALLBACK = 'mktemp "${TMPDIR:-/tmp}/x.XXXXXX"';

  function sandboxSettings(allowUnsandboxedCommands: boolean): string {
    return JSON.stringify({ sandbox: { enabled: true, allowUnsandboxedCommands, excludedCommands: [], filesystem: { denyWrite: DENY_SET } } });
  }

  function writeUserSettings(allowUnsandboxedCommands: boolean): void {
    fs.mkdirSync(path.join(c.home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(c.home, '.claude', 'settings.json'), sandboxSettings(allowUnsandboxedCommands));
  }

  function writeManagedSettings(allowUnsandboxedCommands: boolean): void {
    fs.mkdirSync(path.dirname(managedSettingsPath()), { recursive: true });
    fs.writeFileSync(managedSettingsPath(), sandboxSettings(allowUnsandboxedCommands));
  }

  /**
   * @behavior Covering, locked sandbox settings in the USER's own settings don't count (a session
   *   can edit them), so our wrap still runs.
   * @user-story US-005, D4
   */
  it('given covering, locked sandbox settings only in user settings, when the main agent makes a mixed call, then it is sent back wrapped', async () => {
    // Given
    writeUserSettings(false);

    // When
    const result = await gate('npm -v >/dev/null 2>&1; echo ok > notes.txt', MAIN_AGENT, MAC_OK);

    // Then
    expect(result.exitCode).toBe(0);
    expect(String(wrappedCommand(result)).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  });

  /**
   * @behavior Covering, locked MANAGED settings count as the OS layer: no nested wrap, no notice,
   *   and no loosening (the mktemp fallback is refused exactly as today).
   * @user-story US-005 (AC-005.1 as revised by D4)
   */
  it('given covering, locked managed sandbox settings, when the main agent runs the mktemp fallback, then it is refused as today and not rewritten', async () => {
    // Given
    writeManagedSettings(false);

    // When
    const mixed = await gate('npm -v >/dev/null 2>&1; echo ok > notes.txt', MAIN_AGENT, MAC_OK);
    const fallback = await gate(MKTEMP_FALLBACK, MAIN_AGENT, MAC_OK);

    // Then
    expect(mixed.exitCode).toBe(0);
    expect(hookOutput(mixed)?.updatedInput).toBeUndefined();
    expect(notice(mixed)).toBeNull();
    expect(fallback.exitCode).toBe(2);
    expect(hookOutput(fallback)?.updatedInput).toBeUndefined();
  });

  /**
   * @behavior Managed sandbox settings that allow unsandboxed commands don't count as the OS layer:
   *   no rewrite (Seatbelt can't nest), text rules, and one notice naming Claude Code's sandbox.
   * @user-story US-005 (AC-005.2), D4
   */
  it('given managed sandbox settings that allow unsandboxed commands, when the main agent makes a mixed call, then it is not rewritten and carries the notice', async () => {
    // Given
    writeManagedSettings(true);

    // When
    const result = await gate('npm -v >/dev/null 2>&1; echo ok > notes.txt', MAIN_AGENT, MAC_OK);

    // Then
    expect(result.exitCode).toBe(0);
    expect(hookOutput(result)?.updatedInput).toBeUndefined();
    const line = notice(result);
    expect(line).not.toBeNull();
    expect(line).toMatch(/\boff\b/i);
    expect(line).toMatch(/Claude Code/i);
  });
});
