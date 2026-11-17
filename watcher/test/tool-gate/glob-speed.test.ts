/**
 * @behavior The gate reads a word full of `[` (unclosed bracket expressions, `[[:` runs) in time that
 *   grows with the word's length, so a builder's or the main agent's push to main hidden behind such a
 *   word is still found and refused within a second.
 * @business-rule R-266 round 9 (perf CRITICAL-1, HIGH-1): finding where each `[` closes was cubic or
 *   quadratic, so `echo [[:[[:… ; git push --force origin main` ran past the gate's time limit and was
 *   allowed unchecked.
 * @boundary hasShellWildcard (patterns.ts), which the tokenizer runs on every word; the gate
 *   (runToolGate) for the push.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hasShellWildcard, shellPatternMatchesPath } from '../../src/tool-gate/patterns.js';
import { runToolGate } from '../../src/tool-gate/gate.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('finding wildcards in words full of [', () => {
  it.each([
    ['[[: x 3,000', '[[:'.repeat(3000)],
    ['[ x 50,000', '['.repeat(50_000)],
    ['[[:a x 3,000', '[[:a'.repeat(3000)],
    ['[\\ x 20,000', '[\\'.repeat(20_000)],
  ])('reads %s in under 100 ms', (_name, word) => {
    hasShellWildcard('x');
    expect(timed(() => hasShellWildcard(word))).toBeLessThan(100);
  });

  it.each([
    ['*', true],
    ['a?', true],
    ['[ab]', true],
    ['[]a]', true],
    ['[!]]', true],
    ['[[:alpha:]]', true],
    ['[[:a]b:]', true],
    ['[\\]]', true],
    ['\\[a]', false],
    ['[', false],
    ['[]', false],
    ['[[:', false],
    ['a\\*', false],
    ['[x\\', false],
  ])('still reads %s as wildcard: %s', (word, wild) => {
    expect(hasShellWildcard(word)).toBe(wild);
  });

  it('reads one word with thousands of glob qualifiers after a long start in under 200 ms', () => {
    const command = `echo ${'a'.repeat(30_000)}*(x)${'b(x)'.repeat(8000)}; git push --force origin main`;
    readCommand('echo x', '/w', '/h');
    expect(timed(() => readCommand(command, '/w', '/h'))).toBeLessThan(200);
  });

  it('still matches bracket expressions in shell patterns', () => {
    expect(shellPatternMatchesPath('/a/[bc]d', '/a/cd', {}, false)).toBe(true);
    expect(shellPatternMatchesPath('/a/[bc]d', '/a/xd', {}, false)).toBe(false);
    expect(shellPatternMatchesPath('/a/[[:a]b:]', '/a/[ab:]', {}, false)).toBe(true);
    expect(shellPatternMatchesPath('/a/[x', '/a/[x', {}, false)).toBe(true);
  });
});

describe("a builder's or the main agent's push behind a word full of [", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-glob-speed-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it.each([
    ['main', undefined, `echo ${'[[:'.repeat(1000)} >/dev/null; git push --force origin main`],
    ['builder', 'oss:typescript-pro', `echo ${'[[:'.repeat(1000)} >/dev/null; git push --force origin main`],
    ['main', undefined, `${'['.repeat(25_000)}; git push --force origin main`],
    ['builder', 'oss:typescript-pro', `${'['.repeat(25_000)}; git push --force origin main`],
  ])("refuses the %s agent's push in under 1 s", async (_who, agent, command) => {
    const input = { session_id: 's', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent ? { agent_type: agent } : {}) };
    const started = performance.now();
    const result = await runToolGate({
      mode: 'pre',
      input: JSON.stringify(input),
      env: { HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, TMPDIR: os.tmpdir() },
    });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });
});
