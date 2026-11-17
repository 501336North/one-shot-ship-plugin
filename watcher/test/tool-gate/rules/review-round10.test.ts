/**
 * @behavior Round 10 (part A) gate fixes for review agents:
 *   - D-R10-1 / SEC HIGH-2: Read, Grep and Glob under a home folder reach only the reviewed repos and
 *     the toolchain folders the sandbox allows, also through `/System/Volumes/Data`; `/.vol` and
 *     `~user` forms are refused; a Grep or Glob rooted at or above a home is refused; Claude Code's
 *     session transcripts (`<temp>/claude-*\/**\/tasks/**`) are refused. Outside the homes, temp and
 *     system paths stay readable.
 *   - SEC HIGH-1: the project folder counts as a readable repo only when it is a real git toplevel;
 *     a readable root that is or holds a home fails closed.
 *   - D-R10-2 / SEC MEDIUM-1 / LOW-4: Write, Edit, MultiEdit and NotebookEdit go only to the agent's
 *     own private folder `<T>/oss-review/<session>/<agent id>`, plus a NEW offload prompt.md in a
 *     private mktemp folder; the refusal names the folder to use.
 *   - SEC LOW-1: with no sandbox, `node --test` may not write profiles or snapshots into the repo.
 *   - CR LOW-1: `--test-reporter-destination=stdout|stderr` is allowed.
 *   - CR LOW-2: a bare JS tool names its runnable form.
 *   - PERF LOW-1: an over-long path or pattern is refused, not walked.
 * @business-rule R-266: a review agent may not change what it judges, nor read beyond what it reviews.
 * @boundary runToolGate (gate.ts) with review-agent and builder hook inputs. HOME is the test run's
 *   own temp home (test/setup.ts); the user's real home is only named in paths, never read.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTSIDE_SANDBOX_NOTE, runToolGate, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';

/** The one answer a review agent's Bash call allowed outside the sandbox gets (round 10, with SEC INFO-1 in the hook). */
const OUTSIDE = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'This command runs outside the review sandbox.' } })}\n`;

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REAL_HOME = os.userInfo().homedir;
const REVIEWER = 'oss:code-reviewer';
const BUILDER = 'oss:typescript-pro';
const SESSION = `r10-${process.pid}`;
const AGENT_ID = 'agent-a1';
let root: string;
let repo: string;
let userTemp: string;
let own: string;

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r10-')));
  // the reviewed repo sits under the home folder, beside another project
  repo = path.join(HOME, 'dev', 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'x\n');
  fs.mkdirSync(path.join(HOME, 'dev', 'other'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'dev', 'other', 'secret.ts'), 'x\n');
  fs.writeFileSync(path.join(HOME, '.zsh_history'), 'x\n');
  fs.mkdirSync(path.join(HOME, '.nvm'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.gitconfig'), '[user]\n');
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
  own = path.join(userTemp, 'oss-review', SESSION, AGENT_ID);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
});

interface CallOptions {
  agent?: string | null;
  platform?: NodeJS.Platform;
  tool?: string;
  input?: Record<string, unknown>;
  cwd?: string;
  projectDir?: string;
  agentId?: string | null;
  sandbox?: 'off' | 'real';
}

function call(opts: CallOptions): Promise<GateResult> {
  const agent = opts.agent === undefined ? REVIEWER : opts.agent;
  const agentId = opts.agentId === undefined ? AGENT_ID : opts.agentId;
  const cwd = opts.cwd ?? repo;
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: SESSION,
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: opts.tool ?? 'Read',
        tool_input: opts.input ?? {},
        ...(agent === null ? {} : { agent_type: agent }),
        ...(agentId === null ? {} : { agent_id: agentId }),
      }),
      env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: opts.projectDir ?? repo, TMPDIR: os.tmpdir(), ...((opts.sandbox ?? 'off') === 'off' ? { OSS_TOOL_GATE_SANDBOX: 'off' } : {}) },
      hookEnv: { PATH: '/usr/bin:/bin', HOME },
      bundleRoot: PLUGIN_ROOT,
    },
    { platform: opts.platform ?? 'darwin', sandbox: { userTemp, settingsHomes: [HOME] } },
  );
}

const read = (file_path: string, extra: CallOptions = {}): Promise<GateResult> => call({ tool: 'Read', input: { file_path }, ...extra });
const grep = (p: string | undefined, extra: CallOptions = {}): Promise<GateResult> => call({ tool: 'Grep', input: { pattern: 'x', ...(p === undefined ? {} : { path: p }) }, ...extra });
const glob = (pattern: string, p?: string): Promise<GateResult> => call({ tool: 'Glob', input: { pattern, ...(p === undefined ? {} : { path: p }) } });

/** Round 11, SEC LOW-2: the gate's post call after the agent's own offload step 1 printed `<folder>/prompt.md`. */
function ownMktemp(folder: string, agent = REVIEWER): Promise<GateResult> {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', `${agent.slice(agent.indexOf(':') + 1)}.md`), 'utf8');
  const command = [...text.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2] ?? '').find((b) => b.includes('mktemp -d -t oss-offload')) ?? '';
  return runToolGate(
    {
      mode: 'post',
      input: JSON.stringify({ session_id: SESSION, cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: `${folder}/prompt.md\n` }, agent_type: agent, agent_id: AGENT_ID }),
      env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME },
      bundleRoot: PLUGIN_ROOT,
    },
    { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] } },
  );
}

describe('D-R10-1: Read, Grep and Glob mirror the sandbox allowlist', () => {
  const refused: [string, () => Promise<GateResult>][] = [
    ['Read another project in ~/dev', () => read(path.join(HOME, 'dev/other/secret.ts'))],
    ['Read ~/.zsh_history', () => read('~/.zsh_history')],
    ['Read Library/Application Support', () => read(path.join(HOME, 'Library/Application Support/x/state.json'))],
    ['Read the real home .zsh_history', () => read(path.join(REAL_HOME, '.zsh_history'))],
    ['Read through the firmlink', () => read(`/System/Volumes/Data${fs.realpathSync(HOME)}/.zsh_history`)],
    ['Read the real home through the firmlink', () => read(`/System/Volumes/Data${REAL_HOME}/.zsh_history`)],
    ['Read the firmlink in other letter case', () => read(`/system/volumes/data${fs.realpathSync(HOME)}/.zsh_history`)],
    ['Read /.vol', () => read('/.vol/16777230/2')],
    ['Read ~user', () => read(`~${os.userInfo().username}/.zsh_history`)],
    ['Read ~root', () => read('~root/.ssh/id_rsa')],
    ['Read a session transcript in /private/tmp', () => read('/private/tmp/claude-501/-Users-x/abc/tasks/b1.output')],
    ['Read a session transcript through /tmp', () => read('/tmp/claude-501/-Users-x/abc/tasks/b1.output')],
    ['Read a session transcript in TMPDIR', () => read(path.join(os.tmpdir(), 'claude-501/p/s/tasks/x.output'))],
    ['Grep the home folder', () => grep(HOME)],
    ['Grep ~/dev, above the repo', () => grep(path.join(HOME, 'dev'))],
    ['Grep /Users', () => grep('/Users')],
    ['Grep /', () => grep('/')],
    ['Grep /System/Volumes/Data', () => grep('/System/Volumes/Data')],
    ['Grep /private/tmp (holds transcripts)', () => grep('/private/tmp')],
    ['Grep a claude-* folder', () => grep('/private/tmp/claude-501')],
    ['Glob *.md at the home folder', () => glob('*.md', HOME)],
    ['Glob from above the homes', () => glob('/Users/*/.zsh_history')],
    ['Glob through the firmlink', () => glob(`/System/Volumes/Data${REAL_HOME}/**/*.json`)],
    ['Glob transcripts', () => glob('/private/tmp/claude-501/**/*.output')],
    ['Glob climbing out of the repo after a wildcard', () => glob('src/**/../../../other/*.ts')],
    ['Read a path over 4096 characters', () => read(`${repo}/${'a/'.repeat(2100)}x`)],
    ['Grep a path over 512 segments', () => grep(`${repo}/${'a/'.repeat(600)}`)],
  ];
  for (const [what, run] of refused) {
    it(`refuses: ${what}`, async () => {
      const result = await run();
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('gate-agent-write');
    });
  }

  const allowed: [string, () => Promise<GateResult>][] = [
    ['Read a file in the reviewed repo', () => read(path.join(repo, 'src/a.ts'))],
    ['Read a relative file in the repo', () => read('src/a.ts')],
    ['Read ~/.gitconfig (toolchain)', () => read('~/.gitconfig')],
    ['Read a toolchain folder', () => read(path.join(HOME, '.nvm/versions/node/v20/lib/x.js'))],
    ['Read a system file', () => read('/usr/include/stdio.h')],
    ['Read a temp file', () => read('/private/tmp/notes.txt')],
    ['Read a scratchpad file beside transcripts', () => read('/private/tmp/claude-501/-Users-x/abc/scratchpad/notes.md')],
    ['Read its own private folder', () => read(path.join(own, 'notes.md'))],
    ['Grep the repo (default folder)', () => grep(undefined)],
    ['Grep a repo subfolder', () => grep(path.join(repo, 'src'))],
    ['Grep a folder outside the homes', () => grep('/usr/include')],
    ['Glob in the repo', () => glob('**/*.ts')],
    ['Glob in a repo subfolder', () => glob('src/**/*.ts', repo)],
  ];
  for (const [what, run] of allowed) {
    it(`allows: ${what}`, async () => {
      const result = await run();
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });
  }

  it('leaves builders and the main agent unchanged', async () => {
    for (const agent of [BUILDER, null]) {
      expect((await read(path.join(HOME, 'dev/other/secret.ts'), { agent })).exitCode).toBe(0);
      expect((await grep(HOME, { agent })).exitCode).toBe(0);
    }
  });
});

describe('SEC HIGH-1: only real git toplevels are readable repo roots', () => {
  it('drops a project folder that is not a toplevel (HOME as the project folder): its other files stay refused', async () => {
    expect((await read(path.join(HOME, 'dev/other/secret.ts'), { projectDir: HOME })).exitCode).toBe(2);
    expect((await read(path.join(repo, 'src/a.ts'), { projectDir: HOME })).exitCode).toBe(0);
  });

  it('drops a parent folder holding two repos: a planted .env beside them stays refused', async () => {
    const parent = path.join(HOME, 'dev');
    fs.writeFileSync(path.join(parent, '.env'), 'X=1\n');
    expect((await read(path.join(parent, '.env'), { projectDir: parent, cwd: parent })).exitCode).toBe(2);
  });

  it('fails closed when a readable repo root is the home folder (a dotfiles repo at HOME)', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: HOME });
    try {
      const result = await read(path.join(HOME, '.zsh_history'), { projectDir: HOME, cwd: HOME });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('home folder');
    } finally {
      removeInScratchHome(HOME, '.git');
    }
  });
});

describe("D-R10-2: a review agent's Write/Edit tools go only to its own private folder", () => {
  const write = (file_path: string, extra: CallOptions = {}): Promise<GateResult> => call({ tool: 'Write', input: { file_path, content: 'x' }, ...extra });

  it('allows a write in its own per-agent folder', async () => {
    const result = await write(path.join(own, 'notes.md'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('refuses temp, /tmp, another agent\'s folder and the session folder, naming the folder to use', async () => {
    for (const target of ['/tmp/review.md', path.join(os.tmpdir(), 'review.md'), path.join(userTemp, 'oss-review', SESSION, 'other-agent', 'x.md'), path.join(userTemp, 'oss-review', SESSION, 'x.md')]) {
      const result = await write(target);
      expect(result.exitCode, target).toBe(2);
      expect(result.stderr, target).toContain(own);
    }
  });

  it('refuses Edit, MultiEdit and NotebookEdit outside the folder too', async () => {
    expect((await call({ tool: 'Edit', input: { file_path: '/tmp/x.md', old_string: 'a', new_string: 'b' } })).exitCode).toBe(2);
    expect((await call({ tool: 'MultiEdit', input: { file_path: '/tmp/x.md', edits: [] } })).exitCode).toBe(2);
    expect((await call({ tool: 'NotebookEdit', input: { notebook_path: '/tmp/x.ipynb', new_source: '' } })).exitCode).toBe(2);
  });

  it('uses the session folder when the hook names no agent id', async () => {
    expect((await write(path.join(userTemp, 'oss-review', SESSION, 'x.md'), { agentId: null })).exitCode).toBe(0);
  });

  it('ignores an agent id that is not a safe name (falls back to the session folder)', async () => {
    expect((await write(path.join(userTemp, 'oss-review', 'x.md'), { agentId: '..' })).exitCode).toBe(2);
    expect((await write(path.join(userTemp, 'oss-review', SESSION, 'x.md'), { agentId: '../..' })).exitCode).toBe(0);
  });

  describe('the offload exception: a NEW prompt.md in a private mktemp folder directly in temp', () => {
    function promptFolder(): string {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'oss-offload.'));
    }

    it('allows creating prompt.md there', async () => {
      const folder = promptFolder();
      try {
        await ownMktemp(folder);
        const result = await write(path.join(folder, 'prompt.md'));
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    });

    it('refuses overwriting an existing prompt.md, another name, a folder open to others, or a link', async () => {
      const cases: [string, (folder: string) => string][] = [
        ['prompt.md exists', (folder) => (fs.writeFileSync(path.join(folder, 'prompt.md'), 'x'), path.join(folder, 'prompt.md'))],
        ['another file name', (folder) => path.join(folder, 'other.md')],
        ['folder open to others', (folder) => (fs.chmodSync(folder, 0o755), path.join(folder, 'prompt.md'))],
        [
          'folder is a link',
          (folder) => {
            const link = `${folder}L`;
            fs.symlinkSync(folder, link);
            return path.join(link, 'prompt.md');
          },
        ],
        ['folder not directly in temp', (folder) => (fs.mkdirSync(path.join(folder, 'oss-offload.inner'), { mode: 0o700 }), path.join(folder, 'oss-offload.inner', 'prompt.md'))],
      ];
      for (const [what, make] of cases) {
        const folder = promptFolder();
        try {
          expect((await write(make(folder))).exitCode, what).toBe(2);
        } finally {
          fs.rmSync(`${folder}L`, { force: true });
          fs.rmSync(folder, { recursive: true, force: true });
        }
      }
    });
  });

  it('leaves builders and the main agent unchanged', async () => {
    for (const agent of [BUILDER, null]) expect((await write('/tmp/x.md', { agent })).exitCode).toBe(0);
  });
});

describe('Bash rules for review agents (fallback, no sandbox)', () => {
  const bash = (command: string): Promise<GateResult> => call({ tool: 'Bash', input: { command }, platform: 'linux' });

  it('SEC LOW-1: refuses node --test profiles written into the repo and snapshot updates', async () => {
    for (const command of ['node --test --cpu-prof', 'node --test --heap-prof test/', 'node --test --test-update-snapshots', `node --test --cpu-prof --cpu-prof-dir ${repo}`]) {
      expect((await bash(command)).exitCode, command).toBe(2);
    }
  });

  it('SEC LOW-1: allows profiles pointed into temp', async () => {
    for (const command of ['node --test --cpu-prof --cpu-prof-dir /tmp/prof', 'node --test --heap-prof --heap-prof-dir=/tmp/prof', 'node --test --cpu-prof --diagnostic-dir /tmp/d']) {
      const result = await bash(command);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    }
  });

  it('CR LOW-1: allows the reporter destination stdout and stderr', async () => {
    for (const command of ['node --test --test-reporter=spec --test-reporter-destination=stdout', 'node --test --test-reporter-destination stderr']) {
      const result = await bash(command);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    }
  });

  it('CR LOW-2: a bare JS tool that would write names the form that runs', async () => {
    for (const command of ['tsc', 'tsc -p .']) {
      const result = await bash(command);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toContain('npx --no-install tsc --noEmit');
      expect(result.stderr, command).toContain('node_modules/.bin/tsc --noEmit');
    }
    const eslint = await bash('eslint --fix src');
    expect(eslint.stderr).toContain('npx --no-install eslint');
  });
});

describe.runIf(process.platform === 'darwin')('served review steps and Bash calls in the real sandbox (macOS)', () => {
  const AGENTS = ['code-reviewer', 'security-auditor', 'penetration-tester', 'performance-auditor'];
  const blocksOf = (agent: string): string[] =>
    [...fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', `${agent}.md`), 'utf8').matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2] ?? '');
  const bash = (command: string, agent: string, extra: CallOptions = {}): Promise<GateResult> => call({ tool: 'Bash', input: { command }, agent: `oss:${agent}`, sandbox: 'real', ...extra });

  function runWrapped(result: GateResult, cwd: string): { status: number | null; out: string } {
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } };
    const command = parsed.hookSpecificOutput.updatedInput.command;
    expect(command.startsWith('/usr/bin/sandbox-exec ')).toBe(true);
    const ran = spawnSync('/bin/bash', ['-c', command], { cwd, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
    return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
  }

  for (const agent of AGENTS) {
    it(`${agent}: every served bash block passes the gate, the offload step with a real 0700 mktemp folder`, async () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-offload.'));
      try {
        const prompt = path.join(folder, 'prompt.md');
        await ownMktemp(folder, `oss:${agent}`);
        // step 1's Write of the new prompt file is the one write outside the private folder, for an
        // agent whose file has the offload step (round 11, SEC LOW-2: bound to its own mktemp step)
        const offloads = blocksOf(agent).some((b) => b.includes('mktemp -d -t oss-offload'));
        const written = await call({ tool: 'Write', agent: `oss:${agent}`, input: { file_path: prompt, content: 'p' } });
        expect(written.exitCode).toBe(offloads ? 0 : 2);
        fs.writeFileSync(prompt, 'p', { mode: 0o600 });
        const blocks = blocksOf(agent);
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
          const result = await bash(block.replace('<path printed in step 1>', prompt), agent);
          // its own setup step runs as it is, marked with the fixed note the hook looks for
          expect(result, block.slice(0, 60)).toEqual({ exitCode: 0, stdout: OUTSIDE, stderr: '' });
        }
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    });
  }

  it('a wrapped call says where "Operation not permitted" comes from (CR MEDIUM-3)', async () => {
    const result = await bash('git status --short', 'code-reviewer');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("This command runs in the review sandbox: 'Operation not permitted' under your home or outside $TMPDIR comes from the sandbox, not from the code under review.");
  });

  it('SEC HIGH-1: with a parent folder holding two repos as the project folder, the repo reads and the planted .env does not', async () => {
    const parent = path.join(HOME, 'dev');
    fs.writeFileSync(path.join(parent, '.env'), 'X=1\n');
    const result = await bash(`cat src/a.ts && { cat ../.env >/dev/null 2>&1 && echo leaked || echo denied; }`, 'security-auditor', { projectDir: parent });
    expect(result.exitCode).toBe(0);
    expect(runWrapped(result, repo).out).toBe('x\ndenied\n');
  });

  it('SEC HIGH-1: refuses the call when a readable root is the home folder (a dotfiles repo at HOME)', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: HOME });
    try {
      const result = await bash('git status --short', 'code-reviewer', { projectDir: HOME, cwd: HOME });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('home folder');
    } finally {
      removeInScratchHome(HOME, '.git');
    }
  });
});

describe("the fixed note on a review agent's Bash call allowed outside the sandbox", () => {
  const bash = (command: string, extra: CallOptions = {}): Promise<GateResult> => call({ tool: 'Bash', input: { command }, ...extra });

  it('is exactly one constant', () => {
    expect(OUTSIDE_SANDBOX_NOTE).toBe('This command runs outside the review sandbox.');
  });

  it('marks a call the fallback rules allow (sandbox off, or not macOS)', async () => {
    expect(await bash('git status --short')).toEqual({ exitCode: 0, stdout: OUTSIDE, stderr: '' });
    expect(await bash('git status --short', { platform: 'linux' })).toEqual({ exitCode: 0, stdout: OUTSIDE, stderr: '' });
  });

  it.runIf(process.platform === 'darwin')('never marks a call that carries the note text in a path: it is wrapped, or refused', async () => {
    const wrapped = await bash(`cat '/tmp/${OUTSIDE_SANDBOX_NOTE}/x'`, { sandbox: 'real' });
    expect(wrapped.exitCode).toBe(0);
    expect(wrapped.stdout).not.toBe(OUTSIDE);
    expect(wrapped.stdout).toContain('"updatedInput"');
    const refused = await bash(`echo x > '${repo}/${OUTSIDE_SANDBOX_NOTE}'`, { sandbox: 'real' });
    expect(refused.exitCode).toBe(2);
    expect(refused.stdout).toBe('');
  });

  it("is never given to builders, the main agent, or a review agent's other tools", async () => {
    for (const agent of [BUILDER, null]) expect((await bash('git status --short', { agent })).stdout).toBe('');
    expect((await read(path.join(repo, 'src/a.ts'))).stdout).toBe('');
    expect((await call({ tool: 'Write', input: { file_path: path.join(own, 'n.md'), content: 'x' } })).stdout).toBe('');
  });
});
