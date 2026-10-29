#!/usr/bin/env node
/**
 * redact-decision — scrub secrets out of decision record lines before they are committed
 *
 * Usage:
 *   node redact-decision.js < records.ndjson > redacted.ndjson
 *
 * Reads NDJSON on stdin (one decision record per line) and writes the same records with every
 * free-text field passed through the shared secret list (services/redaction.ts); a secret removed from
 * one field is removed from every other text field of the same record too.
 *
 * Exit codes:
 *   0 — every line redacted; all lines written to stdout
 *   1 — a line could not be read; NOTHING is written to stdout (the hook fails closed)
 */
export interface RedactResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function runRedactDecision(input: string): RedactResult;
export declare function main(): Promise<void>;
//# sourceMappingURL=redact-decision.d.ts.map