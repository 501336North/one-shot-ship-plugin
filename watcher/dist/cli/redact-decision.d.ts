#!/usr/bin/env node
/**
 * redact-decision — scrub secrets out of decision record lines before they are committed
 *
 * Usage:
 *   node redact-decision.js < records.ndjson > redacted.ndjson
 *   node redact-decision.js --push-body < record-line.json > body.json
 *
 * Default mode: reads NDJSON on stdin (one decision record per line) and writes the same records with
 * every free-text field passed through the shared secret list (services/redaction.ts); a secret removed
 * from one field is removed from every other text field of the same record too.
 *
 * --push-body: reads ONE committed record line and writes the JSON body for POST /api/v1/decisions —
 * the one place in the plugin that knows that wire shape. The record is redacted again (whole record,
 * BEFORE any cut), then only the API's fields are kept and sized to its schema (UTF-16 units, no split
 * surrogate pair): question/notes 2000; header, recommended, labels, descriptions, each choice 200; at
 * most 20 options and 20 choices; a single-select choice becomes a one-item list; null header and
 * recommended are left out. person, session, answerText and v are never sent.
 *
 * Exit codes:
 *   0 — every line redacted; all lines written to stdout
 *       (--push-body: the body on stdout, or EMPTY stdout when the record has no feature:
 *        not pushable, keep it local)
 *   1 — a line could not be read; NOTHING is written to stdout (the hook fails closed)
 *   2 — (--push-body only) the line is valid JSON but can never be sent: a field has the wrong type
 *       (a null option description counts as no description) or breaks the API's metadata rules
 *       (id, feature, questionKey, answerIndex, kind, command, answeredAt). NOTHING is written to stdout.
 */
export interface RedactResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function runRedactDecision(input: string, args?: string[]): RedactResult;
export declare function main(): Promise<void>;
//# sourceMappingURL=redact-decision.d.ts.map