/**
 * @behavior A single `oss-error` emission is delivered in-band (schema-valid OSSError JSON
 *           on stdout) AND out-of-band (an `OSS_ERROR` JSON line in <project>/.oss/workflow.log),
 *           and the watcher pipeline (LogReader → WorkflowAnalyzer → InterventionGenerator)
 *           turns cheap retryable errors into auto-remediation queue tasks while escalating
 *           expensive ones and wrapping nonconforming lines as OSS-WORKFLOW-901.
 * @acceptance-criteria AC-001.1 through AC-001.3 (emit), AC-004.1 through AC-004.3 (healing)
 * @boundary 1) CLI: watcher/src/cli/oss-error.ts (runOssError — the forced-tool emitter)
 *           2) Watcher loop: real LogReader + WorkflowAnalyzer + InterventionGenerator
 * @user-story US-001 — As a hook/CLI/prompt failure path, I emit one structured OSSError and
 *             it reaches both the calling agent (stdout) and the watcher (workflow.log).
 * @user-story US-004 — As the watcher, I consume OSS_ERROR events and heal cheap retryable
 *             failures automatically, never auto-retrying expensive ones, and never letting a
 *             malformed error line poison the pipeline.
 *
 * London TDD, outside-in: the system boundaries are the emitter CLI entry point and the
 * supervisor's log-consumption pipeline. Filesystem effects run against unique mkdtemp
 * sandboxes (no shared state). No mocking of the units under test.
 *
 * THIS FILE IS EXPECTED TO FAIL (RED):
 * - CLI tests fail because watcher/src/cli/oss-error.ts does not exist yet (dynamic import
 *   inside each test body → clean per-test failure, the suite loader is not crashed).
 * - Watcher tests fail on assertions because OSS_ERROR handling does not exist yet in the
 *   real LogReader/WorkflowAnalyzer/InterventionGenerator.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Real collaborators for the watcher boundary (these modules EXIST — assertions are the RED)
import { LogReader } from '../../src/logger/log-reader';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer';
import { InterventionGenerator, Intervention } from '../../src/intervention/generator';

// ---------------------------------------------------------------------------
// Wire contract types (what the emitter must print — mirrors DESIGN.md schema)
// ---------------------------------------------------------------------------

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type RetryCost = 'cheap' | 'expensive';

interface WireError {
  code: string;
  severity: Severity;
  source: string;
  message: string;
  retry_eligible: boolean;
  retry_hint?: string;
  retry_cost: RetryCost;
  attempt: number;
  context?: Record<string, unknown>;
}

/** Result shape of the future emitter entry point. */
interface EmitterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunOssError = (argv: string[], env: Record<string, string>) => Promise<EmitterResult>;

/**
 * Module under test does not exist yet — this dynamic import rejecting with a
 * missing-module error IS the meaningful RED for the CLI boundary. It is inside
 * the test bodies so the failure is a clean test failure, not a collection crash.
 */
async function loadEmitter(): Promise<RunOssError> {
  const mod = (await import('../../src/cli/oss-error')) as unknown as { runOssError: RunOssError };
  return mod.runOssError;
}

// ---------------------------------------------------------------------------
// Temp-dir sandbox helpers — unique mkdtemp per test, no Date.now collisions
// ---------------------------------------------------------------------------

interface Sandbox {
  projectDir: string;
  ossDir: string;
  logPath: string;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-error-acceptance-'));
  sandboxes.push(projectDir);
  const ossDir = path.join(projectDir, '.oss');
  fs.mkdirSync(ossDir);
  return { projectDir, ossDir, logPath: path.join(ossDir, 'workflow.log') };
}

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Env the emitter sees — project-local resolution pinned to the sandbox. */
function emitterEnv(sandbox: Sandbox): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: sandbox.projectDir,
    HOME: sandbox.projectDir, // guards against ~/.oss/current-project fallback leaking in
  };
}

/** WorkflowLogger-compatible JSON line shape (ts/cmd/event/data). */
interface RawLogLine {
  ts: string;
  cmd: string;
  phase?: string;
  event: string;
  data: Record<string, unknown>;
}

/** Parse the JSON lines of a workflow.log (skips '#' human-summary lines). */
function readLogLines(logPath: string): RawLogLine[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as RawLogLine);
}

function appendRawLine(logPath: string, line: string): void {
  fs.appendFileSync(logPath, `${line}\n`);
}

function appendLogEntry(logPath: string, entry: RawLogLine): void {
  appendRawLine(logPath, JSON.stringify(entry));
}

const RETRY_HINT =
  'Wait 5s then re-run: node watcher/dist/cli/get-copy.js --cmd build (network blip, endpoint healthy)';

/** A fully valid emitter invocation using a code that exists in the registry today. */
function validArgv(overrides: Partial<Record<string, string>> = {}): string[] {
  const flags: Record<string, string> = {
    '--code': 'OSS-API-001',
    '--severity': 'HIGH',
    '--message': 'Prompt fetch failed: ECONNREFUSED one-shot-ship-api.onrender.com',
    '--source': 'hooks/ensure-decrypt-cli.sh',
    '--retry-eligible': 'true',
    '--retry-hint': RETRY_HINT,
    '--retry-cost': 'cheap',
    '--attempt': '0',
    ...overrides,
  };
  return Object.entries(flags).flatMap(([flag, value]) => [flag, value]);
}

// ===========================================================================
// US-001: Emitter CLI boundary — one emission, dual delivery
// ===========================================================================
describe('US-001: oss-error emitter CLI (Acceptance)', () => {
  describe('AC-001.1: valid emission is delivered in-band AND out-of-band', () => {
    it('GIVEN a valid invocation, WHEN the emitter runs, THEN schema-valid OSSError JSON is printed to stdout AND an OSS_ERROR line is appended to workflow.log', async () => {
      // GIVEN — a sandbox project with an empty .oss dir and a fully valid invocation
      const sandbox = makeSandbox();
      const runOssError = await loadEmitter();

      // WHEN — the failure path invokes the emitter once
      const result = await runOssError(
        validArgv({ '--context': JSON.stringify({ endpoint: '/api/v1/prompts/commands/build' }) }),
        emitterEnv(sandbox),
      );

      // THEN — in-band: stdout is schema-valid OSSError JSON the calling agent can parse
      expect(result.exitCode, 'valid emission must exit 0').toBe(0);
      const wire = JSON.parse(result.stdout) as WireError;
      expect(wire.code).toBe('OSS-API-001');
      expect(wire.severity).toBe('HIGH');
      expect(wire.source).toBe('hooks/ensure-decrypt-cli.sh');
      expect(wire.message).toContain('ECONNREFUSED');
      expect(wire.retry_eligible).toBe(true);
      expect(wire.retry_hint).toBe(RETRY_HINT);
      expect(wire.retry_cost).toBe('cheap');
      expect(wire.attempt).toBe(0);
      expect(wire.context).toEqual({ endpoint: '/api/v1/prompts/commands/build' });

      // THEN — out-of-band: workflow.log gained exactly one WorkflowLogger-shaped
      // JSON line with event OSS_ERROR carrying the same payload
      const lines = readLogLines(sandbox.logPath).filter((l) => l.event === 'OSS_ERROR');
      expect(lines, 'exactly one OSS_ERROR line must be appended').toHaveLength(1);
      const logged = lines[0];
      expect(typeof logged.ts, 'log line must be timestamp-stamped').toBe('string');
      expect(typeof logged.cmd).toBe('string');
      expect(logged.data.code).toBe('OSS-API-001');
      expect(logged.data.retry_eligible).toBe(true);
      expect(logged.data.retry_hint).toBe(RETRY_HINT);
      expect(logged.data.attempt).toBe(0);
    });
  });

  describe('AC-001.2: nonconforming input is rejected at the boundary', () => {
    it('GIVEN an unknown error code, WHEN the emitter runs, THEN it exits nonzero, stderr names the problem, and nothing is appended to workflow.log', async () => {
      // GIVEN — a code that is not in the registry
      const sandbox = makeSandbox();
      const runOssError = await loadEmitter();

      // WHEN
      const result = await runOssError(validArgv({ '--code': 'OSS-FAKE-999' }), emitterEnv(sandbox));

      // THEN — rejected loudly, naming the offending value
      expect(result.exitCode, 'unknown code must exit nonzero').not.toBe(0);
      expect(result.stderr).toContain('OSS-FAKE-999');

      // THEN — the log was NOT polluted with a rejected emission
      expect(readLogLines(sandbox.logPath)).toHaveLength(0);
    });

    it('GIVEN a required field is missing (code, severity, message), WHEN the emitter runs, THEN it exits nonzero, stderr names the missing field, and workflow.log is untouched', async () => {
      const requiredFlags = ['--code', '--severity', '--message'] as const;

      for (const missingFlag of requiredFlags) {
        // GIVEN — a valid invocation with one required flag stripped out
        const sandbox = makeSandbox();
        const runOssError = await loadEmitter();
        const argv = validArgv();
        const idx = argv.indexOf(missingFlag);
        argv.splice(idx, 2); // remove flag + its value

        // WHEN
        const result = await runOssError(argv, emitterEnv(sandbox));

        // THEN — nonzero exit and the missing field is named on stderr
        expect(result.exitCode, `missing ${missingFlag} must exit nonzero`).not.toBe(0);
        expect(result.stderr, `stderr must name the missing field ${missingFlag}`).toContain(
          missingFlag.replace('--', ''),
        );

        // THEN — no partial/invalid line reached the log
        expect(readLogLines(sandbox.logPath)).toHaveLength(0);
      }
    });
  });

  describe('AC-001.3: log-sink failure never masks the original error', () => {
    it('GIVEN workflow.log is unwritable, WHEN the emitter runs, THEN the in-band stdout JSON is emitted intact and a warning appears on stderr', async () => {
      // GIVEN — workflow.log path is occupied by a DIRECTORY, so appends must fail
      const sandbox = makeSandbox();
      fs.mkdirSync(sandbox.logPath);
      const runOssError = await loadEmitter();

      // WHEN
      const result = await runOssError(validArgv(), emitterEnv(sandbox));

      // THEN — the in-band delivery still succeeds: intact, parseable OSSError JSON
      const wire = JSON.parse(result.stdout) as WireError;
      expect(wire.code).toBe('OSS-API-001');
      expect(wire.retry_hint).toBe(RETRY_HINT);

      // THEN — the sink failure is surfaced as a warning, not a masked crash
      expect(result.stderr).toMatch(/warn|unwritable|workflow\.log/i);
    });
  });

  describe('NFR-Security: secret redaction before any write', () => {
    it('GIVEN context values containing an sk-ant key and a Bearer token, WHEN the emitter runs, THEN both outputs carry [REDACTED] and never the raw secrets', async () => {
      // GIVEN — a context payload polluted with secret-shaped values
      const sandbox = makeSandbox();
      const runOssError = await loadEmitter();
      const skKey = 'sk-ant-api03-SUPERSECRETVALUE1234567890';
      const bearer = 'Bearer oss_live_deadbeefcafe1234';

      // WHEN
      const result = await runOssError(
        validArgv({ '--context': JSON.stringify({ apiKey: skKey, authHeader: bearer }) }),
        emitterEnv(sandbox),
      );

      // THEN — in-band output is scrubbed
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain(skKey);
      expect(result.stdout).not.toContain(bearer);
      expect(result.stdout).toContain('[REDACTED]');

      // THEN — out-of-band log line is scrubbed too
      const logContent = fs.readFileSync(sandbox.logPath, 'utf-8');
      expect(logContent).not.toContain(skKey);
      expect(logContent).not.toContain(bearer);
      expect(logContent).toContain('[REDACTED]');
    });
  });
});

// ===========================================================================
// US-004: Watcher healing loop boundary — LogReader → analyzer → generator
// ===========================================================================
describe('US-004: watcher consumes OSS_ERROR events and heals (Acceptance)', () => {
  /** Run the real supervisor analysis pipeline over a sandbox workflow.log. */
  async function runPipeline(ossDir: string, now: Date): Promise<Intervention[]> {
    const reader = new LogReader(ossDir);
    const entries = await reader.readAll();
    const analysis = new WorkflowAnalyzer().analyze(entries, now);
    const generator = new InterventionGenerator();
    return analysis.issues.map((issue) => generator.generate(issue));
  }

  /** Seed a plausible in-flight build log: START then an OSS_ERROR emission. */
  function seedErrorLog(logPath: string, now: Date, error: WireError): void {
    const tStart = new Date(now.getTime() - 5000).toISOString();
    const tError = new Date(now.getTime() - 1000).toISOString();
    appendLogEntry(logPath, { ts: tStart, cmd: 'build', event: 'START', data: { args: [] } });
    appendLogEntry(logPath, {
      ts: tError,
      cmd: 'build',
      event: 'OSS_ERROR',
      data: { ...error },
    });
  }

  const baseError: WireError = {
    code: 'OSS-API-001',
    severity: 'HIGH',
    source: 'hooks/ensure-decrypt-cli.sh',
    message: 'Prompt fetch failed: ECONNREFUSED one-shot-ship-api.onrender.com',
    retry_eligible: true,
    retry_hint: RETRY_HINT,
    retry_cost: 'cheap',
    attempt: 0,
  };

  describe('AC-004.1: cheap retryable errors become auto-remediation tasks', () => {
    it('GIVEN a workflow.log with an OSS_ERROR (retry_eligible, cheap, attempt 0), WHEN the supervisor pipeline runs, THEN an auto_remediate queue task is produced whose prompt contains the retry_hint', async () => {
      // GIVEN — a cheap retryable structured error sits in the log
      const sandbox = makeSandbox();
      const now = new Date();
      seedErrorLog(sandbox.logPath, now, baseError);

      // WHEN — the real LogReader → WorkflowAnalyzer → InterventionGenerator pipeline runs
      const interventions = await runPipeline(sandbox.ossDir, now);

      // THEN — the watcher heals: an auto-executing queue task carrying the emitter's hint
      const remediation = interventions.find(
        (i) =>
          i.response_type === 'auto_remediate' &&
          i.queue_task !== undefined &&
          i.queue_task.prompt.includes(RETRY_HINT),
      );
      expect(
        remediation,
        'pipeline must produce an auto_remediate task whose prompt carries retry_hint',
      ).toBeDefined();
      expect(remediation?.queue_task?.auto_execute).toBe(true);
    });
  });

  describe('AC-004.2: expensive errors are never auto-retried', () => {
    it('GIVEN an OSS_ERROR with retry_cost=expensive, WHEN the pipeline runs, THEN the error is surfaced (escalation intervention) but NO auto_remediate task is enqueued', async () => {
      // GIVEN — an expensive retryable error (a retry would burn a full pipeline run)
      const sandbox = makeSandbox();
      const now = new Date();
      seedErrorLog(sandbox.logPath, now, { ...baseError, retry_cost: 'expensive' });

      // WHEN
      const interventions = await runPipeline(sandbox.ossDir, now);

      // THEN — the watcher SAW the structured error (escalation/notify path references it);
      // this guards against a vacuous pass where OSS_ERROR is silently ignored
      const surfaced = interventions.filter((i) => JSON.stringify(i).includes('OSS-API-001'));
      expect(
        surfaced.length,
        'expensive OSS_ERROR must surface as an escalation intervention, not vanish',
      ).toBeGreaterThan(0);

      // THEN — but none of them auto-execute a retry
      const autoRetries = surfaced.filter(
        (i) => i.response_type === 'auto_remediate' && i.queue_task?.auto_execute === true,
      );
      expect(autoRetries, 'expensive errors must never produce auto_remediate tasks').toHaveLength(0);
    });
  });

  describe('AC-004.3: nonconforming error lines are wrapped, never dropped or fatal', () => {
    it('GIVEN a malformed error line in workflow.log, WHEN the LogReader reads it, THEN it is wrapped as a conformant OSS_ERROR with code OSS-WORKFLOW-901 (and the reader never throws)', async () => {
      // GIVEN — a healthy entry followed by a torn/malformed error line (e.g. a crashed
      // writer or a non-adopter script vomiting plaintext into the log)
      const sandbox = makeSandbox();
      const now = new Date();
      appendLogEntry(sandbox.logPath, {
        ts: new Date(now.getTime() - 5000).toISOString(),
        cmd: 'build',
        event: 'START',
        data: { args: [] },
      });
      appendRawLine(sandbox.logPath, '{"ts":"2026-07-20T00:00:00.000Z","cmd":"build","event":"OSS_ERROR","data":{"code":');

      // WHEN — the real LogReader consumes the log (must not throw)
      const reader = new LogReader(sandbox.ossDir);
      const entries = await reader.readAll();

      // THEN — the malformed line is not silently dropped: it surfaces as a conformant
      // OSS_ERROR event wrapped with the dedicated nonconforming code, non-retryable
      const wrapped = entries.find(
        (e) => (e.event as string) === 'OSS_ERROR' && e.data.code === 'OSS-WORKFLOW-901',
      );
      expect(
        wrapped,
        'malformed line must be wrapped as OSS-WORKFLOW-901, not dropped',
      ).toBeDefined();
      expect(wrapped?.data.retry_eligible).toBe(false);
    });
  });
});
