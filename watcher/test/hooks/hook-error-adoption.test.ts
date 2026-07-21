/**
 * @behavior The highest-frequency real hook failures (auth 401/403, network
 *           unreachable, decrypt/binary integrity) emit a structured OSSError:
 *           in-band JSON on stdout, an OSS_ERROR line in the project
 *           workflow.log, the hook's original exit code preserved, and the
 *           existing human recovery guidance (/oss:login, pricing) untouched.
 *           When the emitter dist is absent, hooks behave exactly as before.
 * @acceptance-criteria Task 11 — hook adoption of the standardized error contract
 * @business-rule US-002: hook failures speak the wire contract so the calling
 *                agent and the watcher healing loop can react without parsing prose.
 * @boundary Shell scripts (hooks/fetch-iron-laws.sh, hooks/ensure-decrypt-cli.sh)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = path.join(__dirname, '../../..');
const FETCH_IRON_LAWS = path.join(REPO_ROOT, 'hooks/fetch-iron-laws.sh');
const ENSURE_DECRYPT = path.join(REPO_ROOT, 'hooks/ensure-decrypt-cli.sh');

interface Sandbox {
  home: string;
  projectDir: string;
  ossDir: string;
  stubBin: string;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-adoption-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-adoption-proj-'));
  sandboxes.push(home, projectDir);
  const ossDir = path.join(projectDir, '.oss');
  fs.mkdirSync(ossDir, { recursive: true });
  const stubBin = path.join(home, 'stub-bin');
  fs.mkdirSync(stubBin);
  // fetch-iron-laws.sh requires ~/.oss/config.json with an apiKey
  fs.mkdirSync(path.join(home, '.oss'));
  fs.writeFileSync(
    path.join(home, '.oss', 'config.json'),
    JSON.stringify({ apiKey: 'oss_test_key_not_real' }),
  );
  return { home, projectDir, ossDir, stubBin };
}

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Install an executable `curl` stub in the sandbox PATH. */
function stubCurl(sandbox: Sandbox, script: string): void {
  const stubPath = path.join(sandbox.stubBin, 'curl');
  fs.writeFileSync(stubPath, `#!/bin/bash\n${script}\n`);
  fs.chmodSync(stubPath, 0o755);
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(script: string, sandbox: Sandbox, pluginRoot: string): RunResult {
  const result = spawnSync('bash', [script], {
    encoding: 'utf-8',
    env: {
      // Stub bin first so the hook's curl resolves to the stub — never the network
      PATH: `${sandbox.stubBin}:${process.env.PATH ?? ''}`,
      TMPDIR: os.tmpdir(),
      HOME: sandbox.home,
      CLAUDE_PROJECT_DIR: sandbox.projectDir,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface WireError {
  code: string;
  severity: string;
  source: string;
  message: string;
  retry_eligible: boolean;
  retry_cost: string;
  attempt: number;
}

/** Extract the single OSSError JSON object from a hook's stdout. */
function parseInBandError(stdout: string): WireError {
  const line = stdout
    .split('\n')
    .find((l) => l.trimStart().startsWith('{') && l.includes('"code"'));
  expect(line, `stdout must carry in-band OSSError JSON, got:\n${stdout}`).toBeDefined();
  return JSON.parse(line as string) as WireError;
}

function readWorkflowErrors(ossDir: string): WireError[] {
  const logPath = path.join(ossDir, 'workflow.log');
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((l) => l.includes('"OSS_ERROR"'))
    .map((l) => (JSON.parse(l) as { data: WireError }).data);
}

describe('fetch-iron-laws.sh emits OSSError on auth failures (Task 11)', () => {
  it('should emit OSS-AUTH-001 (retry_eligible=false) and mention /oss:login when the API returns 401', () => {
    // GIVEN — the API answers 401 (curl stub prints body + status line, exits 0)
    const sandbox = makeSandbox();
    stubCurl(sandbox, 'printf \'{"error":"invalid key"}\\n401\'');

    // WHEN
    const result = runHook(FETCH_IRON_LAWS, sandbox, REPO_ROOT);

    // THEN — original exit code preserved
    expect(result.status).toBe(1);

    // THEN — in-band OSSError JSON on stdout with the auth code, not retryable
    const wire = parseInBandError(result.stdout);
    expect(wire.code).toBe('OSS-AUTH-001');
    expect(wire.retry_eligible).toBe(false);

    // THEN — human recovery guidance preserved (401 → /oss:login)
    expect(result.stderr).toContain('/oss:login');

    // THEN — out-of-band OSS_ERROR line reached the project workflow.log
    const logged = readWorkflowErrors(sandbox.ossDir);
    expect(logged.map((e) => e.code)).toContain('OSS-AUTH-001');
  });

  it('should emit OSS-AUTH-002 and mention pricing when the API returns 403', () => {
    // GIVEN — the API answers 403 (subscription expired)
    const sandbox = makeSandbox();
    stubCurl(sandbox, 'printf \'{"error":"subscription expired"}\\n403\'');

    // WHEN
    const result = runHook(FETCH_IRON_LAWS, sandbox, REPO_ROOT);

    // THEN
    expect(result.status).toBe(1);
    const wire = parseInBandError(result.stdout);
    expect(wire.code).toBe('OSS-AUTH-002');
    expect(wire.retry_eligible).toBe(false);
    expect(result.stderr).toContain('pricing');
    expect(readWorkflowErrors(sandbox.ossDir).map((e) => e.code)).toContain('OSS-AUTH-002');
  });

  it('should emit cheap-retryable OSS-API-003 and preserve the curl exit code when the network is unreachable', () => {
    // GIVEN — curl cannot resolve the host (exit 6, nothing printed)
    const sandbox = makeSandbox();
    stubCurl(sandbox, 'exit 6');

    // WHEN
    const result = runHook(FETCH_IRON_LAWS, sandbox, REPO_ROOT);

    // THEN — the original (curl) exit code is preserved
    expect(result.status).toBe(6);

    // THEN — a cheap retryable network error was emitted in-band and to the log
    const wire = parseInBandError(result.stdout);
    expect(wire.code).toBe('OSS-API-003');
    expect(wire.retry_eligible).toBe(true);
    expect(wire.retry_cost).toBe('cheap');
    expect(readWorkflowErrors(sandbox.ossDir).map((e) => e.code)).toContain('OSS-API-003');
  });

  it('should keep the legacy 401 behavior (message + exit 1, no crash) when the emitter is absent', () => {
    // GIVEN — 401 answer but NO emitter dist anywhere (empty plugin root, no cache)
    const sandbox = makeSandbox();
    const emptyPluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-adoption-empty-'));
    sandboxes.push(emptyPluginRoot);
    stubCurl(sandbox, 'printf \'{"error":"invalid key"}\\n401\'');

    // WHEN
    const result = runHook(FETCH_IRON_LAWS, sandbox, emptyPluginRoot);

    // THEN — legacy behavior fully preserved
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/oss:login');
    expect(readWorkflowErrors(sandbox.ossDir)).toHaveLength(0);
  });
});

describe('ensure-decrypt-cli.sh emits OSSError on install failures (Task 11)', () => {
  it('should emit cheap-retryable OSS-API-003 when the binary download fails (network)', () => {
    // GIVEN — no oss-decrypt installed and curl fails on the binary download
    const sandbox = makeSandbox();
    stubCurl(sandbox, 'exit 6');

    // WHEN
    const result = runHook(ENSURE_DECRYPT, sandbox, REPO_ROOT);

    // THEN — original failure exit preserved
    expect(result.status).toBe(1);

    // THEN — structured network error emitted in-band + out-of-band
    const wire = parseInBandError(result.stdout);
    expect(wire.code).toBe('OSS-API-003');
    expect(wire.retry_eligible).toBe(true);
    expect(wire.retry_cost).toBe('cheap');
    expect(readWorkflowErrors(sandbox.ossDir).map((e) => e.code)).toContain('OSS-API-003');
  });

  it('should emit OSS-API-002 when the downloaded binary fails checksum verification', () => {
    // GIVEN — download "succeeds" but the checksum file does not match the binary
    const sandbox = makeSandbox();
    stubCurl(
      sandbox,
      [
        '# last arg after -o is the output file; URL decides the payload',
        'out=""; url=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    -o) out="$2"; shift 2 ;;',
        '    http*) url="$1"; shift ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'if [[ "$url" == *.sha256 ]]; then',
        '  printf \'0000000000000000000000000000000000000000000000000000000000000000  oss-decrypt\\n\' > "$out"',
        'else',
        '  printf \'not-a-real-binary\\n\' > "$out"',
        'fi',
      ].join('\n'),
    );

    // WHEN
    const result = runHook(ENSURE_DECRYPT, sandbox, REPO_ROOT);

    // THEN — original integrity-failure exit preserved
    expect(result.status).toBe(1);

    // THEN — decrypt/integrity failure emitted as OSS-API-002
    const wire = parseInBandError(result.stdout);
    expect(wire.code).toBe('OSS-API-002');
    expect(readWorkflowErrors(sandbox.ossDir).map((e) => e.code)).toContain('OSS-API-002');
  });

  it('should keep the legacy download-failure behavior when the emitter is absent', () => {
    // GIVEN — network failure and no emitter dist available
    const sandbox = makeSandbox();
    const emptyPluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-adoption-empty-'));
    sandboxes.push(emptyPluginRoot);
    stubCurl(sandbox, 'exit 6');

    // WHEN
    const result = runHook(ENSURE_DECRYPT, sandbox, emptyPluginRoot);

    // THEN — legacy behavior: message + exit 1, no structured emission, no crash
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('Failed to download');
    expect(readWorkflowErrors(sandbox.ossDir)).toHaveLength(0);
  });
});
