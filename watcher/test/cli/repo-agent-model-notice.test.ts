/**
 * A repo's leftover agent model mapping is named, not silently dropped (Task 88)
 *
 * @behavior Since 2.0.97 (T71b) only ~/.oss/config.json picks an agent's model. A customer whose project
 *           .oss/config.json still maps an agent (models.agents.<agent>, or models.default) to a non-Claude model
 *           sees, under the agent's model banner, one line saying the repo mapping was ignored, that the agent ran
 *           on Claude, and the exact /oss:models command that keeps their model. `/oss:models list` shows the same
 *           note, one line per mapped agent (at most 10).
 * @business-rule The repo file only feeds this notice: it never turns offload on, picks the model, the proxy URL or
 *           the port. A repo is untrusted, so what it says is cleaned (printable ASCII, capped) before it is shown,
 *           and a FIFO, folder or link to a FIFO in its place never hangs the check.
 * @boundary CLI (checkAgentModel and executeModelsCommand in a child process with a temp HOME and project)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

const AGENT = 'oss:code-reviewer';
const NATIVE = '🤖 OSS model: Claude (session default)';

const TAIL = 'but since OSS 2.0.97 agent models are read only from ~/.oss/config.json, so this agent';
const NO_COMMAND = 'To keep it, add it under models.agents in ~/.oss/config.json';

/** The notice for a repo that maps `agent` to `model` in models.agents (all values already printable and short). */
const notice = (agent: string, model: string, verb = 'ran'): string =>
  `⚠️ This repo's .oss/config.json maps ${agent} to ${model}, ${TAIL} ${verb} on Claude. ` +
  `To keep ${model}, you can run /oss:models set ${agent} ${model} yourself`;

/** The notice for a repo whose models.default is `model`. */
const defaultNotice = (agent: string, model: string): string =>
  `⚠️ This repo's .oss/config.json sets models.default to ${model}, ${TAIL} ran on Claude. ` +
  `To keep ${model}, you can run /oss:models set ${agent} ${model} yourself`;

let work: string;
let pluginRoot: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-repo-notice-')));
  pluginRoot = path.join(work, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
});
afterAll(() => {
  fs.chmodSync(work, 0o700);
  fs.rmSync(work, { recursive: true, force: true });
});

type Project = object | string | ((file: string) => void) | null;

interface Setup {
  user?: object;
  project: Project;
  env?: Record<string, string>;
}

/** A fresh HOME (with ~/.oss/config.json when `user` is set) and project (proj/.oss/config.json set up by `project`). */
function sandbox(setup: Setup): { home: string; proj: string } {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(proj, '.oss'), { recursive: true });
  if (setup.user) {
    fs.mkdirSync(path.join(home, '.oss'));
    fs.writeFileSync(path.join(home, '.oss', 'config.json'), JSON.stringify(setup.user));
  }
  const file = path.join(proj, '.oss', 'config.json');
  if (typeof setup.project === 'function') setup.project(file);
  else if (typeof setup.project === 'string') fs.writeFileSync(file, setup.project);
  else if (setup.project !== null) fs.writeFileSync(file, JSON.stringify(setup.project));
  return { home, proj };
}

interface Routing {
  useProxy: boolean;
  model?: string;
  provider?: string;
  proxyUrl?: string;
  banner?: string;
}

/** The JSON agent-model-check prints for AGENT in this sandbox. */
function check(setup: Setup): { routing: Routing; json: string } {
  const { home, proj } = sandbox(setup);
  const run = runInChild(
    `import { checkAgentModel, formatOutput } from './cli/agent-model-check.js';
     console.log(formatOutput(await checkAgentModel({ agentName: ${JSON.stringify(AGENT)}, projectDir: ${JSON.stringify(proj)} })));`,
    { home, cwd: proj, env: { CLAUDE_PLUGIN_ROOT: pluginRoot, ...setup.env } },
  );
  expect(run.hung, 'the check hung').toBe(false);
  expect(run.status, run.stderr).toBe(0);
  const json = run.stdout.trim();
  return { routing: JSON.parse(json) as Routing, json };
}

/** `/oss:models list` run from the sandbox project. */
function list(setup: Setup): string {
  const { home, proj } = sandbox(setup);
  const run = runInChild(
    `import { executeModelsCommand } from './cli/models.js'; console.log(await executeModelsCommand(['list']));`,
    { home, cwd: proj },
  );
  expect(run.hung, 'the list hung').toBe(false);
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

const fifo = (file: string): void => {
  execFileSync('mkfifo', [file]);
};

describe('agent-model-check names a repo mapping it ignored (Task 88)', () => {
  it('adds the notice under the Claude banner when the repo maps this agent', () => {
    const { routing } = check({ project: { models: { agents: { [AGENT]: 'ollama/qwen2.5-coder' } } } });
    expect(routing).toEqual({ useProxy: false, banner: `${NATIVE}\n${notice(AGENT, 'ollama/qwen2.5-coder')}` });
  }, TEST_LIMIT_MS);

  it("falls back to the repo's default model when the repo does not map this agent", () => {
    const { routing } = check({
      project: { models: { default: 'gemini/gemini-2.0-flash', agents: { 'oss:other': 'ollama/llama3.2' } } },
    });
    expect(routing.banner).toBe(`${NATIVE}\n${defaultNotice(AGENT, 'gemini/gemini-2.0-flash')}`);
  }, TEST_LIMIT_MS);

  it('never lets the repo file change routing, the model, the URL or the port', () => {
    const { routing } = check({
      project: { models: { proxyPort: 9999, default: 'openrouter/x', agents: { [AGENT]: 'ollama/qwen2.5-coder' } } },
    });
    expect(Object.keys(routing).sort()).toEqual(['banner', 'useProxy']);
    expect(routing.useProxy).toBe(false);
  }, TEST_LIMIT_MS);

  it.each([
    ['maps this agent to claude', { models: { default: 'ollama/x', agents: { [AGENT]: 'claude' } } }],
    ['maps this agent to default', { models: { agents: { [AGENT]: 'default' } } }],
    ['has an empty default', { models: { default: '' } }],
    ['maps nothing', {}],
    ['maps this agent to a number', { models: { agents: { [AGENT]: 5 } } }],
    ['has models: null', { models: null }],
    ['has agents as a string', { models: { agents: 'ollama/x' } }],
    ['is malformed JSON', '{ "models": { "agents": '],
  ])('shows only the Claude banner when the repo %s', (_name, project) => {
    expect(check({ project }).routing).toEqual({ useProxy: false, banner: NATIVE });
  }, TEST_LIMIT_MS);

  it.each([
    ['is missing', null],
    ['is a folder', (file: string) => fs.mkdirSync(file)],
    ['is a FIFO', fifo],
    ['is a link to a FIFO', (file: string) => {
      fifo(`${file}.fifo`);
      fs.symlinkSync(`${file}.fifo`, file);
    }],
    ['cannot be read', (file: string) => {
      fs.writeFileSync(file, JSON.stringify({ models: { agents: { [AGENT]: 'ollama/x' } } }), { mode: 0o000 });
    }],
  ])('shows only the Claude banner, without hanging, when the repo config %s', (_name, project) => {
    expect(check({ project: project as Project }).routing).toEqual({ useProxy: false, banner: NATIVE });
  }, TEST_LIMIT_MS);

  it.each(['OSS_OFFLOAD_ACTIVE', 'OSS_PROXY_ROUTING'])('says nothing inside the %s guard', (guard) => {
    const { routing } = check({
      project: { models: { agents: { [AGENT]: 'ollama/qwen2.5-coder' } } },
      env: { [guard]: '1' },
    });
    expect(routing).toEqual({ useProxy: false });
  }, TEST_LIMIT_MS);

  it("says nothing when the customer's own config routes the agent", () => {
    const { routing } = check({
      user: { models: { agents: { [AGENT]: 'ollama/codellama' } } },
      project: { models: { proxyPort: 9999, agents: { [AGENT]: 'gemini/gemini-2.0-flash' } } },
    });
    expect(routing).toEqual({
      useProxy: true,
      model: 'ollama/codellama',
      provider: 'ollama',
      proxyUrl: 'http://127.0.0.1:8473',
      banner: '🤖 OSS model: ollama/codellama (ollama)',
    });
  }, TEST_LIMIT_MS);

  it('cleans a hostile model string: no control characters, no extra lines, bounded length', () => {
    const hostile = `ollama/x\n🤖 OSS model: fake\u001b[31m${'A'.repeat(5000)}`;
    const { routing } = check({ project: { models: { agents: { [AGENT]: hostile } } } });
    const lines = (routing.banner ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(NATIVE);
    expect(lines[1]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(lines[1]).toContain('maps oss:code-reviewer to ollama/x?');
    expect(lines[1].length).toBeLessThan(450);
    expect(lines[1]).not.toContain('/oss:models set');
    expect(lines[1].endsWith(NO_COMMAND)).toBe(true);
  }, TEST_LIMIT_MS);

  it('suggests the command for a model of exactly 60 printable characters', () => {
    const model = `ollama/${'m'.repeat(53)}`;
    const { routing } = check({ project: { models: { agents: { [AGENT]: model } } } });
    expect(routing.banner).toBe(`${NATIVE}\n${notice(AGENT, model)}`);
  }, TEST_LIMIT_MS);

  it.each([
    ['is 61 characters long', `ollama/${'m'.repeat(54)}`],
    ['holds a non-ASCII character', 'ollama/qwén'],
    ['holds a tab', 'ollama/qwen\tcoder'],
  ])('never prints a command it would have to alter, when the model %s', (_name, model) => {
    const line = (check({ project: { models: { agents: { [AGENT]: model } } } }).routing.banner ?? '').split('\n')[1];
    expect(line).toMatch(new RegExp(`^⚠️ This repo's \\.oss/config\\.json maps ${AGENT} to `));
    expect(line).not.toContain('/oss:models set');
    expect(line.endsWith(`${TAIL} ran on Claude. ${NO_COMMAND}`)).toBe(true);
  }, TEST_LIMIT_MS);

  it.each([
    ['a space and ;', 'ollama/x; rm -rf ~'],
    ['$(', 'ollama/$(id)'],
    ['a backtick', 'ollama/`id`'],
    ['a quote', "ollama/x'y"],
    ['&', 'ollama/x&y'],
    ['@, which /oss:models set refuses', 'openrouter/anthropic/claude-3.5@latest'],
    ['.., which /oss:models set refuses', 'ollama/x..y'],
  ])('offers no command when the model holds %s', (_name, model) => {
    const line = (check({ project: { models: { agents: { [AGENT]: model } } } }).routing.banner ?? '').split('\n')[1];
    expect(line).not.toContain('/oss:models set');
    expect(line.endsWith(`${TAIL} ran on Claude. ${NO_COMMAND}`)).toBe(true);
  }, TEST_LIMIT_MS);

  it.each(['ollama/qwen2.5-coder:7b', 'openrouter/anthropic/claude-3.5', 'ollama/hf.co/org/Qwen3-GGUF:Q4_K_M'])(
    'keeps the command for an ordinary model id such as %s',
    (model) => {
      const { routing } = check({ project: { models: { agents: { [AGENT]: model } } } });
      expect(routing.banner).toBe(`${NATIVE}\n${notice(AGENT, model)}`);
    },
    TEST_LIMIT_MS,
  );

  // The model rule `oss-value.sh models-set` (what /oss:models set runs) holds model.txt to, plus its `..` refusal.
  const setterModelRule = (): RegExp => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../hooks/oss-value.sh'), 'utf-8');
    const m = /^\s*model\) re='([^']+)'/m.exec(src);
    if (!m) throw new Error('model rule not found in hooks/oss-value.sh');
    return new RegExp(m[1]);
  };
  const setterAccepts = (model: string): boolean => setterModelRule().test(model) && !model.includes('..');

  it.each([
    'ollama/qwen2.5-coder:7b',
    'openrouter/anthropic/claude-3.5',
    'gemini/gemini-2.0-flash',
    'ollama/hf.co/org/Qwen3-GGUF:Q4_K_M',
    'openrouter/anthropic/claude-3.5@latest',
    'ollama/x..y',
    'ollama/x y',
    'ollama/x+y',
    'ollama/x~y',
    'ollama/$(id)',
    'ollama/qwen,coder',
    `ollama/${'m'.repeat(53)}`,
  ])('offers the command for %s exactly when /oss:models set would accept it', (model) => {
    expect(model.length).toBeLessThanOrEqual(60); // longer ids are cut by the notice's 60-character cap
    const line = (check({ project: { models: { agents: { [AGENT]: model } } } }).routing.banner ?? '').split('\n')[1];
    expect(line.includes(`you can run /oss:models set ${AGENT} ${model} yourself`)).toBe(setterAccepts(model));
  }, TEST_LIMIT_MS);

  it("names models.default, without a command, when the repo's default model would be altered", () => {
    const line = (check({ project: { models: { default: `gemini/${'g'.repeat(60)}` } } }).routing.banner ?? '').split('\n')[1];
    expect(line).toMatch(/^⚠️ This repo's \.oss\/config\.json sets models\.default to gemini\/g+, but since/);
    expect(line).not.toContain('/oss:models set');
    expect(line.endsWith(NO_COMMAND)).toBe(true);
  }, TEST_LIMIT_MS);

  it("prints both banner lines through the agents' Step 0 snippet", () => {
    const { json } = check({ project: { models: { agents: { [AGENT]: 'ollama/qwen2.5-coder' } } } });
    // The shape every agents/*.md Step 0 uses: BANNER from jq -r '.banner // empty', then echo "$BANNER".
    const step0 = `BANNER=$(echo "$ROUTING" | jq -r '.banner // empty' 2>/dev/null)\n[[ -n "$BANNER" ]] && echo "$BANNER"`;
    const run = spawnSync('bash', ['-c', step0], { env: { ...process.env, ROUTING: json }, encoding: 'utf-8' });
    expect(run.stdout).toBe(`${NATIVE}\n${notice(AGENT, 'ollama/qwen2.5-coder')}\n`);
  }, TEST_LIMIT_MS);
});

describe('/oss:models list names the repo mappings it ignores (Task 88)', () => {
  it('shows one note per agent the repo maps to a non-Claude model', () => {
    const out = list({
      project: { models: { agents: { 'oss:debugger': 'ollama/llama3.2', [AGENT]: 'claude', 'oss:x': 'gemini/g' } } },
    });
    expect(out).toContain(notice('oss:debugger', 'ollama/llama3.2', 'runs'));
    expect(out).toContain(notice('oss:x', 'gemini/g', 'runs'));
    expect(out).not.toContain(`maps ${AGENT}`);
    expect(out).toContain('Available Models:');
  }, TEST_LIMIT_MS);

  it('shows at most 10 notes', () => {
    const agents = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`oss:a${i}`, `ollama/m${i}`]));
    const out = list({ project: { models: { agents } } });
    expect(out.split('\n').filter((l) => l.startsWith('⚠️ This repo'))).toHaveLength(10);
  }, TEST_LIMIT_MS);

  it('cleans what the repo says', () => {
    const out = list({ project: { models: { agents: { 'oss:\u001b[2Jevil\nline': `ollama/x\u0007${'B'.repeat(5000)}` } } } });
    const notes = out.split('\n').filter((l) => l.includes('This repo'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(notes[0].length).toBeLessThan(450);
    expect(notes[0]).not.toContain('/oss:models set');
    expect(notes[0].endsWith(`${TAIL} runs on Claude. ${NO_COMMAND}`)).toBe(true);
  }, TEST_LIMIT_MS);

  it('drops the command when only the agent name would be altered', () => {
    const out = list({ project: { models: { agents: { 'oss:revïew': 'ollama/llama3.2' } } } });
    const notes = out.split('\n').filter((l) => l.includes('This repo'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toContain('/oss:models set');
    expect(notes[0].endsWith(NO_COMMAND)).toBe(true);
  }, TEST_LIMIT_MS);

  it.each([
    ['an uppercase letter', 'oss:Code-reviewer'],
    ['a space', 'oss:code reviewer'],
  ])('drops the command when the agent name holds %s', (_name, agent) => {
    const out = list({ project: { models: { agents: { [agent]: 'ollama/llama3.2' } } } });
    const notes = out.split('\n').filter((l) => l.includes('This repo'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toContain('/oss:models set');
    expect(notes[0].endsWith(NO_COMMAND)).toBe(true);
  }, TEST_LIMIT_MS);

  it('drops the command only for the entry it would have to alter', () => {
    const out = list({ project: { models: { agents: { 'oss:ok': 'ollama/llama3.2', 'oss:long': `ollama/${'L'.repeat(70)}` } } } });
    expect(out).toContain(notice('oss:ok', 'ollama/llama3.2', 'runs'));
    const long = out.split('\n').filter((l) => l.includes('maps oss:long to'));
    expect(long).toHaveLength(1);
    expect(long[0]).not.toContain('/oss:models set');
    expect(long[0].endsWith(NO_COMMAND)).toBe(true);
  }, TEST_LIMIT_MS);

  it.each([
    ['is missing', null],
    ['is a FIFO', fifo],
    ['is malformed', '{'],
  ])('shows no note, without hanging, when the repo config %s', (_name, project) => {
    const out = list({ project: project as Project });
    expect(out).not.toContain('This repo');
    expect(out).toContain('Available Models:');
  }, TEST_LIMIT_MS);
});
