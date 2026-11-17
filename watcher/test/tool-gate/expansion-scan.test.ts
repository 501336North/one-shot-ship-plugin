/**
 * @behavior The gate finds a risky variable set inside an expansion or arithmetic (`${CDPATH:=x}`,
 *   `((CDPATH=1))`, `$((IFS=1))`) in time that grows with the command's length, never faster: a long
 *   command built to make the search slow is read in a few milliseconds instead of seconds.
 * @business-rule R-266 round 7 performance CRITICAL: a slow search let a builder's or the main agent's
 *   `git push --force origin main # ((CDPATH[…` run past the gate's time limit and be allowed unchecked.
 * @boundary readCommand (command-reader.ts) and riskyExpansionVariable (review-commands.ts), the two
 *   places the command text is searched; the gate (runToolGate) for the push.
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import { riskyExpansionVariable } from '../../src/tool-gate/rules/review-commands.js';
import { runToolGate } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const HOSTILE: Array<[string, string]> = [
  ["'(' x 1,000,000", '('.repeat(1_000_000)],
  ["'((CDPATH[' x 100,000", '((CDPATH['.repeat(100_000)],
  ["'${CDPATH[' x 100,000", '${CDPATH['.repeat(100_000)],
  ["'((' then spaces", `((CDPATH${' '.repeat(200_000)}`],
];

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('searching a command for variables set in expansions and arithmetic', () => {
  for (const [name, text] of HOSTILE) {
    it(`reads ${name} in well under the gate's 1 s decision limit`, () => {
      // warm up once (regex compile, JIT), then time; a generous bound, so a loaded machine can't
      // fail it (round 9, CR LOW-3), still far below the seconds the old search took
      riskyExpansionVariable('x');
      expect(timed(() => riskyExpansionVariable(text))).toBeLessThan(1000);
      // the whole read (the tokenizer stops at its own limits) stays under the gate's 1 s decision limit;
      // a generous bound, so a loaded machine can't fail it (round 10, CR MEDIUM-1)
      expect(timed(() => readCommand(text, '/w', '/h'))).toBeLessThan(1000);
    });
  }

  /**
   * Round 18: @behavior a command that is a flood of operators (`(` x 1,000,000, `;` or newlines) is
   *   refused as too complex as soon as it passes the call's operator limit, not after reading all of it.
   * @business-rule a read that ends near the gate's 1 s limit is refused by the clock on a loaded machine
   *   and allowed-or-refused by chance; the reading limits must stop it in a few milliseconds instead.
   */
  it.each([
    ["'(' x 1,000,000", '('.repeat(1_000_000)],
    ["';' x 1,000,000", ';'.repeat(1_000_000)],
    ['newline x 1,000,000', '\n'.repeat(1_000_000)],
  ])('refuses %s at its operator limit, long before reading it all', (_name, text) => {
    readCommand('x', '/w', '/h');
    let read: ReturnType<typeof readCommand> | undefined;
    // far below the ~1 s the full read took (round 18), generous for a loaded machine
    expect(timed(() => (read = readCommand(text, '/w', '/h')))).toBeLessThan(200);
    expect(read).toMatchObject({ unreadable: true, limit: true, reason: expect.stringContaining('too many operators') });
  });

  it.each([
    ['${CDPATH:=.git}', 'CDPATH'],
    ['${PATH=x}', 'PATH'],
    ['${HOME::=x}', 'HOME'],
    ['${CDPATH[0]=x}', 'CDPATH'],
    ['echo $((IFS=1))', 'IFS'],
    ['((CDPATH=1))', 'CDPATH'],
    ['(( x = 1, PATH += 2 ))', 'PATH'],
    ['((((CDPATH=1))))', 'CDPATH'],
  ])('still finds %s', (command, variable) => {
    expect(riskyExpansionVariable(command)).toBe(variable);
  });

  /**
   * Round 9 (CR MEDIUM-5): @behavior an array index longer than the search reads (256 characters)
   * still counts as a set of the variable, so a long index can't hide `${CDPATH[…]=x}`.
   * @business-rule what the gate can't read in full is taken as the risky case (fail closed).
   */
  it.each([
    ['${CDPATH[' + 'x'.repeat(300) + ']=.git}', 'CDPATH'],
    ['${CDPATH[' + 'x'.repeat(300), 'CDPATH'],
    ['((CDPATH[' + '1'.repeat(300) + ']=1))', 'CDPATH'],
    ['((CDPATH[' + '1'.repeat(300) + '))', 'CDPATH'],
  ])('takes a set of the variable behind an index over 256 characters: %#', (command, variable) => {
    expect(riskyExpansionVariable(command)).toBe(variable);
  });

  it.each(['((a == 1))', 'echo ${PATH}', '${PATH:-x}', '((CDPATH))', '((i++))'])('finds nothing in %s', (command) => {
    expect(riskyExpansionVariable(command)).toBeNull();
  });

  it("still reads `cd` after `${CDPATH:=.git}` as lost", () => {
    const read = readCommand('echo ${CDPATH:=.git}; cd hooks && echo x > pre-commit', '/w', '/h');
    const parts = 'parts' in read ? read.parts : [];
    expect(parts.at(-1)?.lostDir).not.toBeNull();
  });

  it('refuses a builder\'s `git push --force origin main # ((CDPATH[` x 1,500 instead of letting it through unchecked', async () => {
    const command = `git push --force origin main # ${'((CDPATH['.repeat(1500)}`;
    const started = performance.now();
    const result = await runToolGate({
      mode: 'pre',
      input: JSON.stringify({ session_id: 's', cwd: os.tmpdir(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, agent_type: 'oss:typescript-pro' }),
      env: { HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, TMPDIR: os.tmpdir() },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
