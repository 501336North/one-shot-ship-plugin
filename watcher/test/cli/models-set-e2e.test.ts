/**
 * /oss:models set really saves the model (Task 88b)
 *
 * @behavior A customer who runs `/oss:models set oss:code-reviewer ollama/qwen2.5-coder` gets that mapping in
 *           ~/.oss/config.json. The command goes through `oss-value.sh models-set`, which runs the plugin's
 *           `models.js set <agents|commands|skills> <name> <model>`; the older `models.js set <name> <model>` still
 *           works. A type that does not match the name is refused and nothing is written.
 * @business-rule The T88 notice and commands/models.md send customers to this command, so it must work end to end.
 *           A mapping is never written under a type the name does not belong to.
 * @boundary The real hooks/oss-value.sh and the real watcher/dist/cli/models.js, run with a real node in a sandbox
 *           HOME (the plugin root is this checkout).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const PLUGIN_ROOT = path.resolve(__dirname, '../../..');
const OSS_VALUE = path.join(PLUGIN_ROOT, 'hooks', 'oss-value.sh');
const MODELS_JS = path.join(PLUGIN_ROOT, 'watcher', 'dist', 'cli', 'models.js');
const LIMIT_MS = 20_000;

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-models-set-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** A fresh HOME whose ~/.oss/plugin-root is this checkout, and a working folder outside any git repo. */
function sandbox(): { home: string; cwd: string } {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  fs.mkdirSync(path.join(home, '.oss'), { mode: 0o700 });
  fs.writeFileSync(path.join(home, '.oss', 'plugin-root'), `${PLUGIN_ROOT}\n`);
  const cwd = path.join(home, 'work');
  fs.mkdirSync(cwd);
  return { home, cwd };
}

function run(cmd: string, args: string[], home: string, cwd: string): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    timeout: LIMIT_MS,
    killSignal: 'SIGKILL',
    env: { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Run `/oss:models set <prompt> <model>` as commands/models.md does: the value files, then oss-value.sh models-set. */
function modelsSet(prompt: string, model: string): { home: string; status: number | null; out: string } {
  const { home, cwd } = sandbox();
  const dir = run('bash', [OSS_VALUE, 'dir'], home, cwd);
  expect(dir.status, dir.out).toBe(0);
  const valueDir = dir.out.trim();
  fs.writeFileSync(path.join(valueDir, 'prompt.txt'), `${prompt}\n`);
  fs.writeFileSync(path.join(valueDir, 'model.txt'), `${model}\n`);
  return { home, ...run('bash', [OSS_VALUE, 'models-set'], home, cwd) };
}

function savedModels(home: string): unknown {
  const file = path.join(home, '.oss', 'config.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as { models?: unknown }).models : undefined;
}

describe('/oss:models set saves the mapping end to end (Task 88b)', () => {
  it.each([
    ['an agent', 'oss:code-reviewer', 'ollama/qwen2.5-coder', { agents: { 'oss:code-reviewer': 'ollama/qwen2.5-coder' } }],
    ['a command', '/oss:ship', 'gemini/gemini-2.0-flash', { commands: { 'oss:ship': 'gemini/gemini-2.0-flash' } }],
    ['a skill', 'tdd:red', 'ollama/llama3.2', { skills: { 'tdd:red': 'ollama/llama3.2' } }],
  ])('saves %s through oss-value.sh models-set', (_kind, prompt, model, want) => {
    const r = modelsSet(prompt, model);
    expect(r.status, r.out).toBe(0);
    expect(savedModels(r.home)).toEqual(want);
  }, LIMIT_MS);

  it('refuses, and writes nothing, when the type models-set derives does not match the name', () => {
    // models-set files a name without oss: under skills; setModel knows `tdd-red` as an agent name
    const r = modelsSet('tdd-red', 'ollama/llama3.2');
    expect(r.out).toContain('Usage: /oss:models set <prompt> <model>');
    expect(savedModels(r.home)).toBeUndefined();
  }, LIMIT_MS);

  it('still saves with the two-argument form', () => {
    const { home, cwd } = sandbox();
    const r = run('node', [MODELS_JS, 'set', 'oss:code-reviewer', 'ollama/qwen2.5-coder'], home, cwd);
    expect(r.status, r.out).toBe(0);
    expect(savedModels(home)).toEqual({ agents: { 'oss:code-reviewer': 'ollama/qwen2.5-coder' } });
  }, LIMIT_MS);

  it.each([
    ['commands', 'oss:code-reviewer'],
    ['agents', 'oss:ship'],
    ['hooks', 'oss:code-reviewer'],
  ])('refuses type %s for %s and writes nothing', (type, name) => {
    const { home, cwd } = sandbox();
    const r = run('node', [MODELS_JS, 'set', type, name, 'ollama/qwen2.5-coder'], home, cwd);
    expect(r.out).toContain('Usage: /oss:models set <prompt> <model>');
    expect(savedModels(home)).toBeUndefined();
  }, LIMIT_MS);
});
