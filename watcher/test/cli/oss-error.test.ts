/**
 * oss-error CLI Tests — argument parsing, validation, dual delivery, redaction
 *
 * @behavior A failure path invokes the oss-error emitter once and gets a
 *           schema-valid OSSError JSON on stdout; nonconforming invocations
 *           are rejected loudly at the boundary with zero side effects.
 * @business-rule Every OSS error crossing a process boundary conforms to the
 *                wire contract (US-001, ADR-001) — the registry is the single
 *                source of truth for known codes.
 * @acceptance-criteria AC-001.1, AC-001.2, AC-001.3, NFR-Security
 * @boundary CLI: watcher/src/cli/oss-error.ts (runOssError)
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OSSError } from '../../src/services/error-codes.js';

interface EmitterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunOssError = (argv: string[], env: Record<string, string>) => Promise<EmitterResult>;

/** Module under test — dynamic import so a missing module is a clean test failure. */
async function loadEmitter(): Promise<RunOssError> {
  const mod = (await import('../../src/cli/oss-error.js')) as unknown as {
    runOssError: RunOssError;
  };
  return mod.runOssError;
}

interface Sandbox {
  projectDir: string;
  ossDir: string;
  logPath: string;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-error-unit-'));
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

/** Env pinned to the sandbox — no leakage into the real ~/.oss. */
function emitterEnv(sandbox: Sandbox): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: sandbox.projectDir,
    HOME: sandbox.projectDir,
  };
}

function validArgv(overrides: Partial<Record<string, string>> = {}): string[] {
  const flags: Record<string, string> = {
    '--code': 'OSS-API-001',
    '--severity': 'HIGH',
    '--message': 'Prompt fetch failed: ECONNREFUSED',
    '--source': 'hooks/ensure-decrypt-cli.sh',
    '--retry-eligible': 'true',
    '--retry-hint': 'Wait 5s then re-run the fetch',
    '--retry-cost': 'cheap',
    '--attempt': '0',
    ...overrides,
  };
  return Object.entries(flags).flatMap(([flag, value]) => [flag, value]);
}

describe('oss-error CLI — Task 3: argument parsing & validation', () => {
  it('should exit nonzero with a validation message when code is unknown', async () => {
    // GIVEN — a code that is not in the error registry
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();

    // WHEN
    const result = await runOssError(validArgv({ '--code': 'OSS-FAKE-999' }), emitterEnv(sandbox));

    // THEN — rejected loudly, naming the offending code, with zero writes
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('OSS-FAKE-999');
    expect(fs.existsSync(sandbox.logPath)).toBe(false);
  });

  it('should exit nonzero when required fields are missing (code, severity, message)', async () => {
    const requiredFlags = ['--code', '--severity', '--message'] as const;

    for (const missingFlag of requiredFlags) {
      // GIVEN — a valid invocation with one required flag removed
      const sandbox = makeSandbox();
      const runOssError = await loadEmitter();
      const argv = validArgv();
      const idx = argv.indexOf(missingFlag);
      argv.splice(idx, 2);

      // WHEN
      const result = await runOssError(argv, emitterEnv(sandbox));

      // THEN — nonzero exit, stderr names the missing field, no writes
      expect(result.exitCode, `missing ${missingFlag} must exit nonzero`).not.toBe(0);
      expect(result.stderr).toContain(missingFlag.replace('--', ''));
      expect(fs.existsSync(sandbox.logPath)).toBe(false);
    }
  });

  it('should reject invalid JSON passed to --context, naming the flag', async () => {
    // GIVEN — a context payload that is not valid JSON
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();

    // WHEN
    const result = await runOssError(validArgv({ '--context': '{not json' }), emitterEnv(sandbox));

    // THEN — nonzero exit, stderr names context, no writes
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('context');
    expect(fs.existsSync(sandbox.logPath)).toBe(false);
  });

  it('should accept a fully valid invocation and print schema-valid JSON to stdout', async () => {
    // GIVEN — a fully valid invocation
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();

    // WHEN
    const result = await runOssError(
      validArgv({ '--context': JSON.stringify({ endpoint: '/api/v1/prompts/commands/build' }) }),
      emitterEnv(sandbox),
    );

    // THEN — exit 0 and stdout parses through the shared wire validator
    expect(result.exitCode).toBe(0);
    const wire: unknown = JSON.parse(result.stdout);
    const validated = OSSError.fromWireJSON(wire);
    expect(validated.code).toBe('OSS-API-001');
    expect(validated.severity).toBe('HIGH');
    expect(validated.message).toContain('ECONNREFUSED');
    expect(validated.retry_eligible).toBe(true);
    expect(validated.retry_cost).toBe('cheap');
    expect(validated.attempt).toBe(0);
    expect(validated.context).toEqual({ endpoint: '/api/v1/prompts/commands/build' });
  });
});

/** WorkflowLogger-compatible JSON line shape. */
interface RawLogLine {
  ts: string;
  cmd: string;
  event: string;
  data: Record<string, unknown>;
}

function readLogLines(logPath: string): RawLogLine[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as RawLogLine);
}

describe('oss-error CLI — Task 4: dual delivery, stamping & redaction', () => {
  it('should print OSSError JSON to stdout AND append an OSS_ERROR JSON line to workflow.log', async () => {
    // GIVEN — a sandbox project with an empty .oss dir
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();

    // WHEN — one valid emission
    const result = await runOssError(validArgv(), emitterEnv(sandbox));

    // THEN — in-band stdout JSON
    expect(result.exitCode).toBe(0);
    const wire = OSSError.fromWireJSON(JSON.parse(result.stdout)).toWireJSON();

    // THEN — out-of-band: exactly one WorkflowLogger-shaped OSS_ERROR line
    const lines = readLogLines(sandbox.logPath).filter((l) => l.event === 'OSS_ERROR');
    expect(lines).toHaveLength(1);
    expect(lines[0].data).toEqual({ ...wire });
  });

  it('should stamp source, attempt and timestamp on every emission', async () => {
    // GIVEN — an invocation that omits --source and --attempt
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();
    const argv = validArgv();
    for (const flag of ['--source', '--attempt']) {
      const idx = argv.indexOf(flag);
      argv.splice(idx, 2);
    }

    // WHEN
    const result = await runOssError(argv, emitterEnv(sandbox));

    // THEN — defaults are stamped: source fallback, attempt 0
    expect(result.exitCode).toBe(0);
    const wire = OSSError.fromWireJSON(JSON.parse(result.stdout));
    expect(wire.source).toBe('unknown');
    expect(wire.attempt).toBe(0);

    // THEN — the log line carries an ISO timestamp and a cmd
    const lines = readLogLines(sandbox.logPath).filter((l) => l.event === 'OSS_ERROR');
    expect(lines).toHaveLength(1);
    expect(new Date(lines[0].ts).toISOString()).toBe(lines[0].ts);
    expect(typeof lines[0].cmd).toBe('string');
  });

  it('should still print in-band JSON and warn on stderr when workflow.log is unwritable', async () => {
    // GIVEN — workflow.log path occupied by a directory so appends fail
    const sandbox = makeSandbox();
    fs.mkdirSync(sandbox.logPath);
    const runOssError = await loadEmitter();

    // WHEN
    const result = await runOssError(validArgv(), emitterEnv(sandbox));

    // THEN — in-band delivery intact, sink failure surfaced as warning
    expect(result.exitCode).toBe(0);
    const wire = OSSError.fromWireJSON(JSON.parse(result.stdout));
    expect(wire.code).toBe('OSS-API-001');
    expect(result.stderr).toMatch(/warn|unwritable|workflow\.log/i);
  });

  it('should redact secret-shaped values in context and message before writing', async () => {
    // GIVEN — secrets in both the message and context paths
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();
    const skKey = 'sk-ant-api03-SUPERSECRETVALUE1234567890';
    const bearer = 'Bearer oss_live_deadbeefcafe1234';
    const plainApiKey = 'plain-looking-key-value';

    // WHEN
    const result = await runOssError(
      validArgv({
        '--message': `Auth failed using ${skKey}`,
        '--context': JSON.stringify({ apiKey: plainApiKey, authHeader: bearer }),
      }),
      emitterEnv(sandbox),
    );

    // THEN — neither sink carries any raw secret
    expect(result.exitCode).toBe(0);
    const logContent = fs.readFileSync(sandbox.logPath, 'utf-8');
    for (const sink of [result.stdout, logContent]) {
      expect(sink).not.toContain(skKey);
      expect(sink).not.toContain(bearer);
      expect(sink).not.toContain(plainApiKey);
      expect(sink).toContain('[REDACTED]');
    }
  });

  /**
   * @behavior Secrets nested inside ARRAY values in --context are redacted, not
   *           passed through — arrays are recursed like any other structure.
   * @acceptance-criteria SEC-1 / CR-F1
   * @business-rule A secret must not survive into any sink because it hid in an array.
   */
  it('should redact secrets nested inside array context values (SEC-1)', async () => {
    // GIVEN — a context array carrying a header string secret and an object secret
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();
    const headerSecret = 'sk-ant-abc123deadbeef01';
    const objectSecret = 'sk-ant-xyz9876543210';

    // WHEN
    const result = await runOssError(
      validArgv({
        '--context': JSON.stringify({
          data: [`Authorization: Bearer ${headerSecret}`, { apiKey: objectSecret }],
        }),
      }),
      emitterEnv(sandbox),
    );

    // THEN — both secrets are gone from BOTH sinks
    expect(result.exitCode).toBe(0);
    const logContent = fs.readFileSync(sandbox.logPath, 'utf-8');
    for (const sink of [result.stdout, logContent]) {
      expect(sink).not.toContain(headerSecret);
      expect(sink).not.toContain(objectSecret);
      expect(sink).toContain('[REDACTED]');
    }
  });

  /**
   * @behavior A token embedded in free-text --message, a JWT, and a secret passed
   *           via --source are all scrubbed in BOTH sinks (broadened value patterns
   *           and source now runs through the redactor).
   * @acceptance-criteria SEC-2 / CR-F4 / SEC-5
   * @business-rule Value redaction is not limited to a couple of shapes, and no field
   *                (including source) leaks embedded secrets.
   */
  it('should redact embedded tokens in message, a JWT, and a secret in source (SEC-2)', async () => {
    // GIVEN — a JWT and a bearer token in the message, and a query-string secret in source
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const bearer = 'Bearer oss_live_supersecrettoken99';
    const sourceSecret = 'AKIAIOSFODNN7EXAMPLE';

    // WHEN
    const result = await runOssError(
      validArgv({
        '--message': `auth failed: ${bearer} then ${jwt}`,
        '--source': `hooks/run.sh?access_token=${sourceSecret}`,
      }),
      emitterEnv(sandbox),
    );

    // THEN — none of the secrets survive in either sink
    expect(result.exitCode).toBe(0);
    const logContent = fs.readFileSync(sandbox.logPath, 'utf-8');
    for (const sink of [result.stdout, logContent]) {
      expect(sink, 'JWT must be redacted').not.toContain(jwt);
      expect(sink, 'bearer token must be redacted').not.toContain('oss_live_supersecrettoken99');
      expect(sink, 'secret in source must be redacted').not.toContain(sourceSecret);
      expect(sink).toContain('[REDACTED]');
    }
  });

  /**
   * @behavior An oversized --context is capped so the atomic single-line append can
   *           never exceed the kernel single-write size and interleave under concurrent
   *           writers — the log still holds exactly one parseable JSON line.
   * @acceptance-criteria PERF-6
   * @business-rule One emission = one atomic, self-contained log line.
   */
  it('should cap an oversized context to keep the log line atomically appendable (PERF-6)', async () => {
    // GIVEN — a context far larger than the single-write cap
    const sandbox = makeSandbox();
    const runOssError = await loadEmitter();
    const huge = 'A'.repeat(64 * 1024);

    // WHEN
    const result = await runOssError(
      validArgv({ '--context': JSON.stringify({ blob: huge }) }),
      emitterEnv(sandbox),
    );

    // THEN — exactly one line, it parses, and the persisted line is bounded
    expect(result.exitCode).toBe(0);
    const raw = fs.readFileSync(sandbox.logPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines, 'exactly one JSON line must be appended').toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as RawLogLine;
    expect(parsed.event).toBe('OSS_ERROR');
    expect(Buffer.byteLength(lines[0], 'utf-8'), 'line must be bounded').toBeLessThan(32 * 1024);
    expect((parsed.data.context as Record<string, unknown>)._truncated).toBe(true);
  });
});
