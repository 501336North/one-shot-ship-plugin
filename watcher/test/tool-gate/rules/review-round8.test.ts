/**
 * @behavior Round 8 gate fixes for review agents (both platforms): package scripts whose names say
 *   they publish, deploy, release, migrate, seed or fix are refused even with `ci` or `check` in the
 *   name; grep/rg `-o` is not an output file; ordinary variables (RUST_LOG, JAVA_HOME, CARGO_TERM_COLOR)
 *   pass while risky toolchain ones don't; a `cd` that may fail leaves later relative writes unknown;
 *   tools' profile, report, cache and baseline outputs are temp-only; a write under a folder copied
 *   earlier in the call (links kept) is refused; long words that never reach path work are fine.
 * @business-rule R-266: a review agent may not change what it judges; its ordinary checks still run.
 * @boundary runToolGate (gate.ts) with a review agent's hook input, the sandbox turned off so the
 *   answer is the rules' own.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let repo: string;

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r8-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'src/a\n');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function review(command: string): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ session_id: 's', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, agent_type: 'oss:code-reviewer' }),
      env: { HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
    },
    { platform: 'linux' },
  );
}

function table(name: string, allowed: readonly string[], refused: readonly string[]): void {
  describe(name, () => {
    for (const command of allowed) {
      it(`allows \`${command.slice(0, 80)}\``, async () => {
        const result = await review(command);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
      });
    }
    for (const command of refused) {
      it(`refuses \`${command.slice(0, 80)}\``, async () => {
        expect((await review(command)).exitCode).toBe(2);
      });
    }
  });
}

table(
  'H2: script names that change things count as changing, whatever else they say',
  ['npm run format:check', 'npm run prettier:check', 'npm run test:ci', 'npm run lint', 'pnpm lint', 'npm run deploy:dry-run'],
  ['npm run ci:publish', 'npm run deploy:ci', 'npm run release:ci', 'npm run db:migrate:ci', 'npm run seed:check', 'pnpm lint:fix'],
);

table('M1: script names split on camelCase and dots', ['npm run typecheck', 'npm run lintCheck'], ['npm run lintFix', 'npm run fixLint', 'npm run lint.fix']);

table('M2: -o is a file only for programs whose -o writes one', ['grep -o "src/[a-z]*" a.txt', "rg -o 'a/b' .", 'ls -o .', 'od -o a.txt'], ['sort -o out.txt a.txt']);

table(
  'M3: ordinary variables pass; risky toolchain variables and repo paths do not',
  ['RUST_LOG=debug cargo test', 'JAVA_HOME=/usr/lib/jvm/java-21 mvn test', 'CARGO_TERM_COLOR=always cargo test', 'MY_LOG=out.log npm test'],
  ['CARGO_TARGET_DIR=./target cargo test', 'CARGO_HOME=/opt/cargo cargo test', 'CARGO_BUILD_RUSTC=/x/rustc cargo test', 'CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER=/x cargo test', 'PYLINTHOME=./cache pylint src'],
);

table(
  'MEDIUM-1: a cd that may fail leaves later relative writes unknown',
  ['cd /tmp && echo x > /tmp/x.txt', 'cd /tmp && echo x > x.txt'],
  ['cd ~ || cd /tmp; echo x > x', 'false && cd /tmp; echo x > x', 'cd /tmp/nope; echo x > .env', 'if cd /tmp/nope; then :; else echo x > x; fi'],
);

table(
  'MEDIUM-2: profile, report, cache and baseline outputs go to temp only',
  ['semgrep --config auto --text-output=/tmp/semgrep.txt .', 'golangci-lint run --cpu-profile-path /tmp/cpu.out'],
  [
    'staticcheck -debug.cpuprofile=prof.out ./...',
    'staticcheck -debug.trace=trace.out ./...',
    'golangci-lint run --cpu-profile-path cpu.out',
    'golangci-lint run --mem-profile-path mem.out',
    'golangci-lint run --trace-path trace.out',
    'semgrep --config auto --text-output=out.txt .',
    'pylint --output-format=json:out.json src',
    'swiftlint --cache-path .cache',
    'psalm --report=out.json',
    'dotnet build -bl:out.binlog',
    'pyright --writebaseline',
    'pyright --createstub foo',
    'mypy --sqlite-cache .',
    'npx --no-install playwright test --reporter=html',
    'turbo run test --summarize',
    'semgrep --config auto --junit-xml-output=out.xml .',
  ],
);

table('LOW-1: a write under a folder copied earlier in the call', ['cp -a a.txt /tmp/r8-copy.txt', 'cp -R . /tmp/r8-tree'], ['cp -a . /tmp/r8-c && echo x > /tmp/r8-c/a.txt', 'cp -R . /tmp/r8-d; echo x > /tmp/r8-d/link/x']);

table(
  'LOW-3: long words that never reach path work are fine',
  [`echo "${'r'.repeat(7000)}" > /tmp/r8-report.md`, `grep -rn "${'p'.repeat(5000)}" .`],
  [`echo x > /tmp/${'d'.repeat(5000)}`],
);

describe('L4 and LOW-3: refusal texts', () => {
  it('asks for the temp folder written out in full, without naming $TMPDIR', async () => {
    const result = await review('echo x > notes.md');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain('$TMPDIR');
    expect(result.stderr).toContain('in full');
  });

  it('suggests a heredoc for a word too long to check', async () => {
    const result = await review(`echo x > /tmp/${'d'.repeat(5000)}`);
    expect(result.stderr).toContain('heredoc');
  });
});

describe('perf LOW 1: many path candidates in one part', () => {
  it('answers in well under the decision limit, refusing a part with too many to check', async () => {
    const words = Array.from({ length: 2000 }, (_, i) => `a${i}=b=c=d=e=f=g=h=/x${i}`).join(' ');
    const started = performance.now();
    const result = await review(`eslint ${words}`);
    expect(result.exitCode).toBe(2);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
