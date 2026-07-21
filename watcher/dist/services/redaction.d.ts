/**
 * Shared secret redaction — the single implementation used by the emitter
 * (oss-error.ts) and every consumer-side path (generator.ts, log-monitor.ts)
 * so a secret never survives into a sink or a queue-task prompt (defense in depth).
 *
 * All patterns are linear (bounded character classes, no nested quantifiers) to
 * avoid catastrophic backtracking on adversarial input.
 */
/** Scrub secret-shaped substrings out of a single free-text string. */
export declare function redactString(value: string): string;
/**
 * Deep-redact a context object: secret-shaped keys are fully masked, string
 * values are scrubbed, and arrays/nested objects are recursed into.
 */
export declare function redactSecrets(context: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=redaction.d.ts.map