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
export interface EmitterResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function runOssError(argv: string[], env: Record<string, string>): Promise<EmitterResult>;
export declare function main(): Promise<void>;
//# sourceMappingURL=oss-error.d.ts.map