/**
 * @behavior Every bash block OSS's own served commands give the main agent and builders runs
 *   through the tool gate without a refusal (R-266 round 11, D-R11-1).
 * @business-rule The gate never blocks OSS's own instructions: a served /oss:plan or /oss:ship
 *   step that the gate refuses would stop every customer's workflow.
 * @boundary runToolGate (watcher/src/tool-gate/gate.ts), fed Claude Code hook JSON, in a throwaway repo
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runToolGate } from '../../src/tool-gate/gate.js';
import { apiCommandFiles, apiStatus, blocksOf, FIXTURE, PLUGIN_ROOT, pluginCommandFiles } from '../../scripts/served-command-blocks.mjs';

interface Fixture {
  source: string;
  files: Record<string, string[]>;
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE as string, 'utf8')) as Fixture;
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway repo on a feature branch, with an active feature's dev docs, as the served commands expect. */
function workRepo(): string {
  const repo = tempDir('oss-served-');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Served Blocks Test']);
  git(repo, ['config', 'user.email', 'served-blocks@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  git(repo, ['checkout', '-q', '-b', 'feat/login-form/build']);
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', 'login-form'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.oss', 'dev', 'active', 'login-form', 'PROGRESS.md'), '# Progress\n');
  return repo;
}

/** Placeholders some blocks hold, with realistic values. */
const PLACEHOLDERS: [string, string][] = [
  ['<files from diff>', 'src/app.ts src/app.test.ts'],
  ['<files modified by auto-fix>', 'src/app.ts'],
  ['<device_id>', 'A1B2C3D4-0000-0000-0000-000000000000'],
];

function filled(block: string): string {
  return PLACEHOLDERS.reduce((text, [from, to]) => text.replaceAll(from, to), block);
}

/**
 * Served blocks a rule outside the cd and path rules still refuses on purpose, each with the refusal
 * it must keep giving (found by this test, R-266 round 11; each needs the served prompt or that rule
 * changed, which is the user's call). Any other refusal fails the test.
 */
const KNOWN_REFUSED: { file: string; holds: string; reason: string }[] = [
  // protected-branch rule: the post-merge sync updates main, and the branch delete names a branch read from a file
  { file: 'api/commands/ship.md', holds: 'git fetch origin refs/heads/main:refs/heads/main', reason: 'changes `main`, a protected branch' },
  { file: 'api/commands/ship.md', holds: 'git branch -d -- "$b"', reason: 'a protected branch' },
  // force-push rule: the served push uses --force-with-lease
  { file: 'api/commands/ship.md', holds: '--force-with-lease=', reason: 'rewrites history' },
  // unreadable rule (ADR-010): an awk `print >` / a sed script only known when it runs, in a risky command
  { file: 'api/commands/ship.md', holds: 's#-----BEGIN [A-Z ]*PRIVATE KEY-----', reason: "part of this command can't be read" },
  { file: 'api/commands/ship-team.md', holds: 'I="$id" E="$e" T="$t" K="$K" awk', reason: "part of this command can't be read" },
];

function knownRefusal(file: string, block: string): string | null {
  return KNOWN_REFUSED.find((k) => k.file === file && block.includes(k.holds))?.reason ?? null;
}

const repo = workRepo();
const home = tempDir('oss-served-home-');

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function decide(command: string, agent: string | null): Promise<{ exitCode: number; stderr: string }> {
  const hook = {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    ...(agent === null ? {} : { agent_type: agent, agent_id: 'b1c2d3e4' }),
  };
  // a fixed hook environment: the gate reads variables a block never sets from it (round 12, D-R12-1), so the machine's own must not count
  const hookEnv = { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir() };
  const result = await runToolGate({ mode: 'pre', input: JSON.stringify(hook), env: { TMPDIR: os.tmpdir(), HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT as string, CLAUDE_PROJECT_DIR: repo }, hookEnv });
  return { exitCode: result.exitCode, stderr: result.stderr };
}

describe('served commands: every bash block runs for the main agent and builders', () => {
  it('has a fixture that matches the served command files', async ({ annotate }) => {
    const plugin = blocksOf(pluginCommandFiles());
    for (const [key, blocks] of Object.entries(plugin)) expect(fixture.files[key], key).toEqual(blocks);
    const api = apiCommandFiles();
    // the API checkout (OSS_API_REPO) is only on the machine that serves it; elsewhere the fixture's
    // copy is checked, and the run says so (round 12, CR L3)
    const status = apiStatus(api, fixture.files);
    if (status !== null) await annotate(status);
    expect(status ?? '').not.toContain('no API blocks');
    if (api.length > 0) {
      const served = blocksOf(api);
      for (const [key, blocks] of Object.entries(served)) expect(fixture.files[key], key).toEqual(blocks);
    }
    const expected = [...Object.keys(plugin), ...api.map((f) => f.key)];
    if (api.length > 0) expect(Object.keys(fixture.files).sort()).toEqual(expected.sort());
  });

  for (const agent of [null, 'oss:typescript-pro']) {
    it(`allows every served block for ${agent ?? 'the main agent'}`, async () => {
      const refused: string[] = [];
      for (const [file, blocks] of Object.entries(fixture.files)) {
        for (const [n, block] of blocks.entries()) {
          const result = await decide(filled(block), agent);
          const known = knownRefusal(file, block);
          if (known !== null) {
            if (result.exitCode !== 2 || !result.stderr.includes(known)) refused.push(`${file} #${n}: expected the known refusal (${known}), got exit ${result.exitCode}: ${result.stderr.trim()}`);
          } else if (result.exitCode !== 0) {
            refused.push(`${file} #${n}: ${result.stderr.trim()}\n    ${block.slice(0, 300).replaceAll('\n', '\n    ')}`);
          }
        }
      }
      expect(refused, refused.join('\n\n')).toEqual([]);
    }, 600_000);
  }
});
