/**
 * @behavior Round 9 (part A) gate fixes for review agents:
 *   - D-R9-2: Read, Grep and Glob calls that would read a credential store (in HOME or the user's
 *     real home, directly, through a link or by searching a folder above one) are refused; builders
 *     and the main agent are unchanged.
 *   - D-R9-3: on macOS, Swift, JVM/Gradle and .NET builds and tests are refused with a clear message.
 *   - CR LOW-2: a package script refused for its name is named in the refusal.
 *   - CR HIGH-2 / SEC HIGH-3: with no sandbox, `node --test` runs only the repo's own tests, from the
 *     repo, with no preload, loader, env file, watch mode or reporter file.
 *   - SEC LOW-2: with no sandbox, go/jest/pytest/cargo output options point into temp only.
 *   - SEC INFO-2 / INFO-3: on macOS a review agent's Bash call runs sandboxed or is refused; a fallback
 *     is logged.
 *   - CR LOW-1: gh can't read its login inside the sandbox, so a sandboxed review agent's gh call is
 *     refused with a pointer to the main agent.
 * @business-rule R-266: a review agent may not change what it judges, nor read the user's credentials.
 * @boundary runToolGate (gate.ts) with review-agent and builder hook inputs. HOME is the test run's
 *   own temp home (test/setup.ts); the user's real home is only named in paths, never read.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTSIDE_SANDBOX_NOTE, runToolGate, type GateResult } from '../../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REAL_HOME = os.userInfo().homedir;
const REVIEWER = 'oss:code-reviewer';
const BUILDER = 'oss:typescript-pro';
let root: string;
let repo: string;
let userTemp: string;

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error('expected the test run\'s temp HOME');
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r9-')));
  repo = path.join(root, 'repo');
  userTemp = path.join(root, 'T');
  fs.mkdirSync(repo);
  fs.mkdirSync(userTemp, { mode: 0o700 });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'test', 'a.test.js'), '');
  fs.mkdirSync(path.join(HOME, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.ssh', 'id_test'), 'FAKE');
  fs.writeFileSync(path.join(HOME, '.netrc'), 'FAKE');
  fs.symlinkSync(path.join(HOME, '.netrc'), path.join(repo, 'innocent.txt'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

interface CallOptions {
  agent?: string | null;
  platform?: NodeJS.Platform;
  sandbox?: 'off' | 'real' | 'broken';
  tool?: string;
  input?: Record<string, unknown>;
}

function call(command: string, opts: CallOptions = {}): Promise<GateResult> {
  const agent = opts.agent === undefined ? REVIEWER : opts.agent;
  const tool = opts.tool ?? 'Bash';
  const sandbox = opts.sandbox ?? 'off';
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r9-session',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: opts.input ?? { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), ...(sandbox === 'off' ? { OSS_TOOL_GATE_SANDBOX: 'off' } : {}) },
      hookEnv: { PATH: '/usr/bin:/bin', HOME },
    },
    // round 12, CR L2: Claude Code's sandbox setting only from the test's own HOME
    { platform: opts.platform ?? 'linux', sandbox: { userTemp, settingsHomes: [HOME], ...(sandbox === 'broken' ? { run: () => false } : {}) } },
  );
}

function table(name: string, allowed: readonly string[], refused: readonly string[], opts: CallOptions = {}): void {
  describe(name, () => {
    for (const command of allowed) {
      it(`allows \`${command.slice(0, 80)}\``, async () => {
        const result = await call(command, opts);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
      });
    }
    for (const command of refused) {
      it(`refuses \`${command.slice(0, 80)}\``, async () => {
        expect((await call(command, opts)).exitCode).toBe(2);
      });
    }
  });
}

describe('D-R9-2: Read, Grep and Glob are gated for review agents', () => {
  const refused: [string, () => Record<string, unknown>][] = [
    ['Read', () => ({ file_path: path.join(HOME, '.ssh/id_test') })],
    ['Read', () => ({ file_path: path.join(HOME, '.netrc') })],
    ['Read', () => ({ file_path: path.join(HOME, '.oss/config.json.bak') })],
    ['Read', () => ({ file_path: path.join(HOME, '.claude.json') })],
    ['Read', () => ({ file_path: path.join(HOME, '.claude/.credentials.json') })],
    ['Read', () => ({ file_path: path.join(HOME, 'Library/Keychains/login.keychain-db') })],
    ['Read', () => ({ file_path: path.join(REAL_HOME, '.config/gh/hosts.yml') })],
    ['Read', () => ({ file_path: path.join(REAL_HOME, '.aws/credentials') })],
    ['Read', () => ({ file_path: '~/.git-credentials' })],
    ['Read', () => ({ file_path: `${HOME}/dev/../.ssh/id_test` })],
    ['Grep', () => ({ pattern: 'token', path: HOME })],
    ['Grep', () => ({ pattern: 'token', path: path.join(REAL_HOME, '.config') })],
    ['Grep', () => ({ pattern: 'token', path: path.join(HOME, '.ssh') })],
    ['Glob', () => ({ pattern: `${HOME}/.ssh/*` })],
    ['Glob', () => ({ pattern: '**/*', path: path.join(HOME, '.aws') })],
    ['Glob', () => ({ pattern: '.config/gh/**', path: REAL_HOME })],
    ['Glob', () => ({ pattern: '**/.npmrc', path: HOME })],
    // round 10, D-R10-1: a Glob rooted at a home folder is refused, credential store or not
    ['Glob', () => ({ pattern: '*.md', path: HOME })],
  ];
  for (const [tool, input] of refused) {
    it(`refuses ${tool} ${String(input).replace('() => ', '')}`, async () => {
      const result = await call('', { tool, input: input() });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('credential stores');
    });
  }

  it('refuses a Read through a link in the repo that leads to a credential file', async () => {
    expect((await call('', { tool: 'Read', input: { file_path: path.join(repo, 'innocent.txt') } })).exitCode).toBe(2);
  });

  it('ignores letter case on macOS', async () => {
    expect((await call('', { tool: 'Read', platform: 'darwin', input: { file_path: path.join(HOME, '.SSH/id_test') } })).exitCode).toBe(2);
  });

  const allowed: [string, () => Record<string, unknown>][] = [
    ['Read', () => ({ file_path: path.join(repo, 'a.txt') })],
    ['Read', () => ({ file_path: path.join(HOME, '.gitconfig') })],
    ['Grep', () => ({ pattern: 'x' })],
    ['Grep', () => ({ pattern: 'x', path: repo })],
    ['Glob', () => ({ pattern: '**/*.ts' })],
  ];
  for (const [tool, input] of allowed) {
    it(`allows ${tool} ${String(input).replace('() => ', '')}`, async () => {
      const result = await call('', { tool, input: input() });
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });
  }

  it('leaves builders and the main agent unchanged', async () => {
    for (const agent of [BUILDER, null]) {
      expect((await call('', { agent, tool: 'Read', input: { file_path: path.join(HOME, '.ssh/id_test') } })).exitCode).toBe(0);
    }
  });
});

describe('D-R9-3: Swift, JVM/Gradle and .NET builds and tests on macOS', () => {
  const commands = ['swift build', 'swift test', 'mvn test', './mvnw verify', 'gradle test', './gradlew check', 'dotnet build', 'dotnet test', 'dotnet run', 'xcodebuild test -scheme App'];
  for (const command of commands) {
    it(`refuses \`${command}\` with the read-the-code message`, async () => {
      const result = await call(command, { platform: 'darwin' });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("this stack's build and tests can't run in the review sandbox; review the code by reading it");
    });
  }

  it('leaves them to the usual rules off macOS, and for builders on macOS', async () => {
    expect((await call('mvn test')).exitCode).toBe(0);
    expect((await call('swift test', { platform: 'darwin', agent: BUILDER })).exitCode).toBe(0);
  });
});

describe('CR LOW-2: a package script refused for its name is named', () => {
  for (const [command, script] of [
    ['npm run deploy', 'deploy'],
    ['npm run seed', 'seed'],
    ['pnpm run db:seed', 'db:seed'],
  ]) {
    it(`names \`${script}\``, async () => {
      const result = await call(command);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(`\`${script}\``);
      expect(result.stderr).not.toContain('is not on the review allowlist');
    });
  }
});

table(
  "CR HIGH-2 / SEC HIGH-3: node --test with no sandbox runs only the repo's own tests",
  ['node --test', 'node --test test/a.test.js', 'node --test --test-reporter=spec', 'node --test --test-name-pattern=a test/', `node --test --cpu-prof-dir=${os.tmpdir()}/prof`],
  [
    'node --test /tmp/x.test.js',
    'node --test ../elsewhere/a.test.js',
    'cd /tmp && node --test',
    'node --test --import /tmp/x.mjs',
    'node --test --import=./setup.mjs',
    'node --test --require /tmp/x.cjs',
    'node --test -r ./x.cjs',
    'node --test --loader /tmp/l.mjs',
    'node --test --experimental-loader=./l.mjs',
    'node --test --env-file=.env',
    'node --test --env-file-if-exists=/tmp/e',
    'node --test --watch',
    'node --test --test-reporter=/tmp/r.mjs',
    'node --test --test-reporter=./r.mjs',
    'node --test --test-reporter-destination=out.txt',
    'node --test --cpu-prof-dir=./prof',
    'node --test --diagnostic-dir=./diag',
    'node --test --experimental-test-coverage --test-coverage-include=/tmp/**',
  ],
);

table(
  'SEC LOW-2: with no sandbox, output options point into temp only',
  [`go test -coverprofile=${os.tmpdir()}/c.out ./...`, 'cargo test', `cargo test --target-dir ${os.tmpdir()}/t`],
  [
    'go test -coverprofile=c.out ./...',
    'go test -coverprofile c.out ./...',
    'go test -cpuprofile=cpu.out ./...',
    'go test -memprofile mem.out ./...',
    'npx --no-install jest --coverageDirectory=cov',
    'npx --no-install jest --coverageDirectory cov',
    'pytest --html=report.html',
    'pytest --html report.html',
    'cargo test --target-dir=t',
    'cargo test --target-dir t',
  ],
);

describe("SEC INFO-2 / INFO-3: on macOS a review agent's Bash call runs sandboxed or is refused", () => {
  it('refuses when the sandbox fails its self-test (no silent fallback)', async () => {
    const result = await call('git status --short', { platform: 'darwin', sandbox: 'broken' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('review sandbox');
  });

  it.runIf(process.platform === 'darwin')('wraps a passing call', async () => {
    const result = await call('git status --short', { platform: 'darwin', sandbox: 'real' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('/usr/bin/sandbox-exec');
  });

  it('logs a fallback', async () => {
    expect((await call('git status --short')).exitCode).toBe(0);
    expect(fs.readFileSync(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'), 'utf8')).toContain('"kind":"review-fallback"');
  });
});

describe('CR LOW-1: gh inside the sandbox', () => {
  it.runIf(process.platform === 'darwin')("refuses a sandboxed review agent's gh call, pointing at the main agent", async () => {
    const result = await call('gh pr view 1', { platform: 'darwin', sandbox: 'real' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("gh can't read its login inside the review sandbox");
  });

  it('keeps read-only gh in the fallback rules', async () => {
    expect((await call('gh pr view 1')).exitCode).toBe(0);
  });
});

describe('SEC MEDIUM-1: the offload step runs only on a prompt file mktemp made for this user', () => {
  const AGENT_FILE = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'code-reviewer.md'), 'utf8');
  const offloadBlock = [...AGENT_FILE.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2] ?? '').find((b) => b.includes('agent-offload.js')) ?? '';

  function offload(folder: string): Promise<GateResult> {
    const command = offloadBlock.replace('<path printed in step 1>', path.join(folder, 'prompt.md'));
    return runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: 'r9-session', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, agent_type: REVIEWER }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
        bundleRoot: PLUGIN_ROOT,
      },
      { platform: 'linux' },
    );
  }

  function promptFolder(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-offload.')));
  }

  it('runs its own offload step on a private mktemp folder holding a regular prompt file', async () => {
    expect(offloadBlock).toContain('PROMPT_FILE=');
    const folder = promptFolder();
    try {
      fs.writeFileSync(path.join(folder, 'prompt.md'), 'prompt');
      // round 10: marked with the one fixed note the hook accepts in place of a rewrite
      expect(await offload(folder)).toEqual({ exitCode: 0, stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: OUTSIDE_SANDBOX_NOTE } })}\n`, stderr: '' });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('is not its own step when the prompt file is a link or a hard link to a credential, or the folder is a link or open to others', async () => {
    const cases: [string, (folder: string) => string][] = [
      ['prompt.md is a symlink', (folder) => (fs.symlinkSync(path.join(HOME, '.ssh/id_test'), path.join(folder, 'prompt.md')), folder)],
      ['prompt.md is a hard link', (folder) => (fs.linkSync(path.join(HOME, '.netrc'), path.join(folder, 'prompt.md')), folder)],
      ['the folder is open to others', (folder) => (fs.chmodSync(folder, 0o755), folder)],
      [
        'the folder is a link',
        (folder) => {
          const link = path.join(os.tmpdir(), `oss-offload.${path.basename(folder).slice(-6)}L`);
          fs.symlinkSync(folder, link);
          return link;
        },
      ],
    ];
    for (const [what, make] of cases) {
      const folder = promptFolder();
      const used = make(folder);
      try {
        expect((await offload(used)).exitCode, what).toBe(2);
      } finally {
        if (used !== folder) fs.rmSync(used, { force: true });
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }
  });
});

describe('D-R9-5: Docker and Kubernetes on macOS', () => {
  const commands = ['docker ps', 'docker compose config', 'docker-compose ps', 'podman ps', 'kubectl get pods', 'helm list', 'k9s'];
  for (const command of commands) {
    it(`refuses \`${command}\` with the review-the-files message`, async () => {
      const result = await call(command, { platform: 'darwin' });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("docker/kubectl can't run in the review sandbox; review the files (Dockerfile, compose, manifests) instead");
    });
  }

  it('leaves builders and the main agent unchanged on macOS', async () => {
    for (const agent of [BUILDER, null]) expect((await call('docker ps', { platform: 'darwin', agent })).exitCode).toBe(0);
  });
});

/**
 * Round 12, CR L2: @behavior the darwin cases here never read the user's own Claude Code settings.
 * @business-rule tests are hermetic: the real ~/.claude can't change their outcome.
 */
describe('round 12, CR L2: no real ~/.claude settings are read', () => {
  it('a darwin review call with the real sandbox reads no file under the real ~/.claude', async () => {
    const realClaude = [path.join(REAL_HOME, '.claude'), path.join(fs.realpathSync(REAL_HOME), '.claude')];
    const spy = vi.spyOn(fs, 'readFileSync');
    let read: string[];
    try {
      await call('git status --short', { platform: 'darwin', sandbox: 'real' });
      read = spy.mock.calls.map((args) => String(args[0]));
    } finally {
      spy.mockRestore();
    }
    expect(read.filter((file) => realClaude.some((dir) => file.startsWith(`${dir}/`)))).toEqual([]);
  });
});
