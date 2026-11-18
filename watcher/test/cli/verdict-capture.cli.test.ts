/**
 * @behavior The verdict-capture CLI that hooks/oss-verdict-capture.sh runs records a review agent's start snapshot at
 *           SubagentStart (`verdict-capture start <input-file>`) and its verdict at SubagentStop (`<input-file>`).
 * @business-rule Round 2 security L4: a stop row counts only when its agent's start snapshot exists and equals it, so
 *           the start mode must reach captureStart; the CLI always exits 0 and prints nothing.
 * @boundary the bundle dist/cli/verdict-capture.cjs (OSS_TEST_VERDICT_CAPTURE_CLI: one built from src outside dist).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { openLedger } from '../../src/phase-results/ledger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = process.env.OSS_TEST_VERDICT_CAPTURE_CLI ?? path.resolve(HERE, '../../dist/cli/verdict-capture.cjs');
const FEATURE = 'cli-feat';

let tmp: string;
let repo: string;
let home: string;
let savedHome: string | undefined;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  savedHome = process.env.HOME;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-cli-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  process.env.HOME = home;
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('checkout', '-q', '-b', `feat/${FEATURE}/ship`);
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', FEATURE), { recursive: true });
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(...args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: { ...process.env, HOME: home }, encoding: 'utf-8', timeout: 20_000 });
  return { status: r.status, stdout: r.stdout };
}

describe('verdict-capture CLI: start mode (security L4)', () => {
  it('`start <input>` records the start snapshot that the stop row then matches', () => {
    const input = path.join(tmp, 'in.json');
    const hook = { session_id: 's1', agent_id: 'agent-9', agent_type: 'oss:security-auditor', cwd: repo };
    fs.writeFileSync(input, JSON.stringify({ ...hook, hook_event_name: 'SubagentStart' }));
    expect(run('start', input)).toEqual({ status: 0, stdout: '' });
    expect(openLedger(repo).hasMarker('verdict-start/agent-9')).toBe(true);

    const block = '```oss-verdict\n{"verdict":"pass","findings":{"critical":0,"high":0,"medium":0,"low":0,"info":0}}\n```';
    fs.writeFileSync(input, JSON.stringify({ ...hook, hook_event_name: 'SubagentStop', last_assistant_message: block }));
    expect(run(input)).toEqual({ status: 0, stdout: '' });
    expect(openLedger(repo).readRows(`verdicts/${FEATURE}`)).toMatchObject([{ gate: 'security', start: 'match' }]);
  });
});
