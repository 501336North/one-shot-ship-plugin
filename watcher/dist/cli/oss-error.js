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
import { ErrorRegistry, OSSError } from '../services/error-codes.js';
import { redactString, redactSecrets } from '../services/redaction.js';
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
];
function isKnownFlag(value) {
    return KNOWN_FLAGS.includes(value);
}
function parseArgv(argv) {
    const flags = new Map();
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
function buildCandidate(flags) {
    const candidate = {
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
        }
        catch {
            throw new Error('invalid JSON for "--context"');
        }
    }
    return candidate;
}
// ---------------------------------------------------------------------------
// Secret redaction — applied to message, retry_hint, source and context before
// ANY write, using the single shared redactor (see services/redaction.ts).
// ---------------------------------------------------------------------------
function redactWire(wire) {
    const redacted = {
        ...wire,
        source: redactString(wire.source),
        message: redactString(wire.message),
    };
    if (redacted.retry_hint !== undefined) {
        redacted.retry_hint = redactString(redacted.retry_hint);
    }
    if (redacted.context !== undefined) {
        redacted.context = redactSecrets(redacted.context);
    }
    return redacted;
}
// ---------------------------------------------------------------------------
// Out-of-band delivery — project-local .oss/workflow.log resolution + append
// ---------------------------------------------------------------------------
/** Resolution order: CLAUDE_PROJECT_DIR → ~/.oss/current-project → git toplevel. */
function resolveOssDir(env) {
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
        }
        catch {
            // No current-project file — fall through to git toplevel
        }
    }
    try {
        const toplevel = execSync('git rev-parse --show-toplevel', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 250,
        }).trim();
        if (toplevel !== '') {
            return path.join(toplevel, '.oss');
        }
    }
    catch {
        // Not in a git repo — no sink available
    }
    return null;
}
/**
 * Atomic single-line append of a WorkflowLogger-compatible OSS_ERROR line.
 * Returns a warning string on failure (never throws — sink failure must not
 * mask the original error).
 */
/** Max serialized log line — keep a single atomic append under the kernel single-write size. */
const MAX_LOG_LINE_BYTES = 16 * 1024;
function appendToWorkflowLog(env, wire) {
    const buildLine = (payload) => JSON.stringify({
        ts: new Date().toISOString(),
        cmd: 'oss-error',
        event: 'OSS_ERROR',
        data: payload,
    });
    let line = buildLine(wire);
    // Cap oversized context so the atomic append can't tear across a concurrent write.
    if (Buffer.byteLength(line, 'utf-8') > MAX_LOG_LINE_BYTES) {
        line = buildLine({ ...wire, context: { _truncated: true } });
    }
    const ossDir = resolveOssDir(env);
    if (ossDir === null) {
        return 'oss-error: warning: could not resolve project .oss dir; OSS_ERROR not appended to workflow.log\n';
    }
    const logPath = path.join(ossDir, 'workflow.log');
    try {
        fs.appendFileSync(logPath, `${line}\n`);
        return null;
    }
    catch (appendError) {
        const message = appendError instanceof Error ? appendError.message : String(appendError);
        return `oss-error: warning: workflow.log unwritable (${message}); in-band JSON still emitted\n`;
    }
}
export async function runOssError(argv, env) {
    const parsed = parseArgv(argv);
    if (!parsed.ok) {
        return { exitCode: 1, stdout: '', stderr: `${parsed.message}\n` };
    }
    let error;
    try {
        error = OSSError.fromWireJSON(buildCandidate(parsed.flags));
    }
    catch (validationError) {
        const message = validationError instanceof Error ? validationError.message : String(validationError);
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
function envFromProcess() {
    const out = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}
export async function main() {
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
//# sourceMappingURL=oss-error.js.map