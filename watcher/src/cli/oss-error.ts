#!/usr/bin/env node
/**
 * oss-error — the forced-tool structured error emitter (US-001, ADR-001)
 *
 * Usage:
 *   node oss-error.js --code OSS-API-001 --severity HIGH --message "..." \
 *     [--source <path>] [--retry-eligible true|false] [--retry-hint "..."] \
 *     [--retry-cost cheap|expensive] [--attempt N] [--context '<json>']
 *
 * Exit codes:
 *   0 — valid emission (schema-valid OSSError JSON printed to stdout)
 *   1 — nonconforming invocation rejected (stderr names the problem, no writes)
 *
 * No network calls — works fully offline.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';
import { ErrorRegistry, OSSError, WireError } from '../services/error-codes.js';

export interface EmitterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const KNOWN_FLAGS = [
  '--code',
  '--severity',
  '--message',
  '--source',
  '--retry-eligible',
  '--retry-hint',
  '--retry-cost',
  '--attempt',
  '--context',
] as const;

type KnownFlag = (typeof KNOWN_FLAGS)[number];

function isKnownFlag(value: string): value is KnownFlag {
  return (KNOWN_FLAGS as readonly string[]).includes(value);
}

type ParseResult =
  | { ok: true; flags: Map<KnownFlag, string> }
  | { ok: false; message: string };

function parseArgv(argv: string[]): ParseResult {
  const flags = new Map<KnownFlag, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!isKnownFlag(flag)) {
      return { ok: false, message: `oss-error: unknown flag "${flag}"` };
    }
    if (value === undefined) {
      return { ok: false, message: `oss-error: missing value for "${flag}"` };
    }
    flags.set(flag, value);
  }
  return { ok: true, flags };
}

/**
 * Build the candidate wire payload with emitter-stamped defaults. Validation
 * itself is delegated to the single shared validator (OSSError.fromWireJSON).
 */
function buildCandidate(flags: Map<KnownFlag, string>): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    source: flags.get('--source') ?? 'unknown',
    retry_eligible: flags.has('--retry-eligible')
      ? flags.get('--retry-eligible') === 'true'
      : false,
    retry_cost: flags.get('--retry-cost') ?? 'cheap',
    attempt: flags.has('--attempt') ? Number(flags.get('--attempt')) : 0,
  };
  if (flags.has('--code')) {
    candidate.code = flags.get('--code');
  }
  if (flags.has('--severity')) {
    candidate.severity = flags.get('--severity');
  }
  if (flags.has('--message')) {
    candidate.message = flags.get('--message');
  }
  if (flags.has('--retry-hint')) {
    candidate.retry_hint = flags.get('--retry-hint');
  }
  if (flags.has('--context')) {
    try {
      candidate.context = JSON.parse(flags.get('--context') ?? '{}');
    } catch {
      throw new Error('invalid JSON for "--context"');
    }
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Secret redaction — applied to message, retry_hint and context before ANY write
// ---------------------------------------------------------------------------

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /Bearer\s+[^\s"']+/g,
];

/** Keys whose values are secrets regardless of shape (apiKey-like). */
const SECRET_KEY_PATTERN = /api[_-]?key|secret|token|password/i;

function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      out[key] = redactString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out[key] = redactContext(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function redactWire(wire: WireError): WireError {
  const redacted: WireError = { ...wire, message: redactString(wire.message) };
  if (redacted.retry_hint !== undefined) {
    redacted.retry_hint = redactString(redacted.retry_hint);
  }
  if (redacted.context !== undefined) {
    redacted.context = redactContext(redacted.context);
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Out-of-band delivery — project-local .oss/workflow.log resolution + append
// ---------------------------------------------------------------------------

/** Resolution order: CLAUDE_PROJECT_DIR → ~/.oss/current-project → git toplevel. */
function resolveOssDir(env: Record<string, string>): string | null {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv !== undefined && fromEnv !== '' && fs.existsSync(fromEnv)) {
    return path.join(fromEnv, '.oss');
  }
  const home = env.HOME;
  if (home !== undefined && home !== '') {
    try {
      const projectDir = fs
        .readFileSync(path.join(home, '.oss', 'current-project'), 'utf-8')
        .trim();
      if (projectDir !== '' && fs.existsSync(projectDir)) {
        return path.join(projectDir, '.oss');
      }
    } catch {
      // No current-project file — fall through to git toplevel
    }
  }
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (toplevel !== '') {
      return path.join(toplevel, '.oss');
    }
  } catch {
    // Not in a git repo — no sink available
  }
  return null;
}

/**
 * Atomic single-line append of a WorkflowLogger-compatible OSS_ERROR line.
 * Returns a warning string on failure (never throws — sink failure must not
 * mask the original error).
 */
function appendToWorkflowLog(env: Record<string, string>, wire: WireError): string | null {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    cmd: 'oss-error',
    event: 'OSS_ERROR',
    data: wire,
  });
  const ossDir = resolveOssDir(env);
  if (ossDir === null) {
    return 'oss-error: warning: could not resolve project .oss dir; OSS_ERROR not appended to workflow.log\n';
  }
  const logPath = path.join(ossDir, 'workflow.log');
  try {
    fs.appendFileSync(logPath, `${line}\n`);
    return null;
  } catch (appendError) {
    const message = appendError instanceof Error ? appendError.message : String(appendError);
    return `oss-error: warning: workflow.log unwritable (${message}); in-band JSON still emitted\n`;
  }
}

export async function runOssError(
  argv: string[],
  env: Record<string, string>,
): Promise<EmitterResult> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: `${parsed.message}\n` };
  }

  let error: OSSError;
  try {
    error = OSSError.fromWireJSON(buildCandidate(parsed.flags));
  } catch (validationError) {
    const message =
      validationError instanceof Error ? validationError.message : String(validationError);
    return { exitCode: 1, stdout: '', stderr: `oss-error: ${message}\n` };
  }

  const registry = new ErrorRegistry();
  if (registry.getError(error.code) === undefined) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `oss-error: unknown error code "${error.code}" (not in registry)\n`,
    };
  }

  const wire = redactWire(error.toWireJSON());
  const warning = appendToWorkflowLog(env, wire);
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(wire)}\n`,
    stderr: warning ?? '',
  };
}

function envFromProcess(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export async function main(): Promise<void> {
  const result = await runOssError(process.argv.slice(2), envFromProcess());
  if (result.stdout !== '') {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== '') {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
