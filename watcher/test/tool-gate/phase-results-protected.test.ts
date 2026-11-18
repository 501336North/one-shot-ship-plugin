/**
 * @behavior Phase results are bound by code: the main agent and builders can't write the owner-only
 *   ledger (`~/.oss/ledger/**`), by an edit tool or by a shell write (`cp`, `tee`, `>`). They can still
 *   read results, write a value file under `~/.oss/run/`, run the phase-result, value and notify hooks,
 *   and archive a whole feature folder.
 * @business-rule R-257 T18b, D22 (user pick 2026-11-18, "Ledger only"): protectedPaths gains only
 *   `~/.oss/ledger/**`. A feature's `results/` folder is not gate-protected: a result written there by
 *   hand doesn't match its ledger binding, which is the guard. `~/.oss/run/**` stays writable because
 *   the model writes value files there by design.
 * @boundary runToolGate (the gate as the hook calls it), with the plugin's real config/tool-gates.json.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
/** A scratch home: never the real ~/.oss. */
let home: string;
let resultFile: string;
let ledgerFile: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r257-results-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  resultFile = path.join(repo, '.oss', 'dev', 'active', 'feat-x', 'results', 'ship.json');
  ledgerFile = path.join(home, '.oss', 'ledger', 'feat-x', 'ship.json');
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(home, '.oss', 'run', 'k1'), { recursive: true });
  fs.writeFileSync(resultFile, '{}');
  fs.writeFileSync(ledgerFile, '{}');
  fs.writeFileSync(path.join(repo, 'forged.json'), '{}');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(toolName: string, toolInput: Record<string, unknown>, agent: string | null): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r257-results',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

async function allowed(toolName: string, toolInput: Record<string, unknown>, agent: string | null): Promise<void> {
  const result = await call(toolName, toolInput, agent);
  expect(result.stderr, JSON.stringify(toolInput)).toBe('');
  expect(result.exitCode, JSON.stringify(toolInput)).toBe(0);
}

async function refused(toolName: string, toolInput: Record<string, unknown>, agent: string | null): Promise<void> {
  const result = await call(toolName, toolInput, agent);
  expect(result.exitCode, JSON.stringify(toolInput)).toBe(2);
  expect(result.stderr, JSON.stringify(toolInput)).toMatch(/^Refused/);
}

describe.each(AGENTS)('%s', (_who, agent) => {
  describe('can not write the ledger', () => {
    it('Write to a ledger file is refused', async () => {
      await refused('Write', { file_path: ledgerFile, content: '{"verdict":"pass"}' }, agent);
    });

    it('Edit of a ledger file is refused', async () => {
      await refused('Edit', { file_path: ledgerFile, old_string: '{}', new_string: '{"verdict":"pass"}' }, agent);
    });

    it.each([
      ['cp into the ledger', () => 'cp forged.json ~/.oss/ledger/feat-x/ship.json'],
      ['tee into the ledger', () => 'echo {} | tee ~/.oss/ledger/feat-x/build.json'],
      ['> into the ledger', () => 'echo {} > "$HOME/.oss/ledger/feat-x/plan.json"'],
    ])('%s is refused', async (_what, command) => {
      await refused('Bash', { command: command() }, agent);
    });
  });

  describe('D22: the results folder is guarded by the ledger binding, not the gate', () => {
    it('a Write to a results file is not refused by the gate', async () => {
      await allowed('Write', { file_path: resultFile, content: '{"verdict":"pass"}' }, agent);
    });
  });

  describe('still does its ordinary work', () => {
    it('writes a value file under ~/.oss/run', async () => {
      await allowed('Write', { file_path: path.join(home, '.oss', 'run', 'k1', 'verdict.txt'), content: 'pass' }, agent);
    });

    it.each([
      '~/.oss/hooks/oss-value.sh timeline gate',
      '~/.oss/hooks/oss-phase-result.sh assemble build',
      "~/.oss/hooks/oss-notify.sh --workflow build complete '{}'",
    ])('runs %s', async (command) => {
      await allowed('Bash', { command }, agent);
    });

    it.each([
      'cat .oss/dev/active/feat-x/results/ship.json',
      'jq . .oss/dev/active/feat-x/results/ship.json',
    ])('reads results with %s', async (command) => {
      await allowed('Bash', { command }, agent);
    });

    it('reads results with the Read tool', async () => {
      await allowed('Read', { file_path: resultFile }, agent);
    });

    it('archives a whole feature folder, results included', async () => {
      await allowed('Bash', { command: 'mv -n .oss/dev/active/feat-x .oss/dev/completed/feat-x-2026-11-18' }, agent);
    });

    it('moves a value folder under ~/.oss/run aside', async () => {
      await allowed('Bash', { command: 'mv -n ~/.oss/run/k1 ~/.oss/run/k1-old' }, agent);
    });
  });
});
