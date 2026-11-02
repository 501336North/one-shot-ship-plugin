/**
 * Shared secret redaction — the single implementation used by the emitter
 * (oss-error.ts), every consumer-side path (generator.ts, log-monitor.ts) and the
 * decision-record redactor (cli/redact-decision.ts), so a secret never survives into a
 * sink, a queue-task prompt or a committed decision record (defense in depth).
 *
 * The list catches every sample the API's decision redaction test catches; the fixture
 * test/fixtures/api-secret-samples.json mirrors that test and must change with it.
 *
 * All patterns are linear (bounded character classes, a fixed-width lookahead per
 * character, no ambiguous nested quantifiers) to avoid catastrophic backtracking.
 */
export interface SecretPattern {
    name: string;
    pattern: RegExp;
    /**
     * When set, a match is redacted only if this returns true; otherwise it is kept as written.
     * `value` is the part that would be redacted; `prefix` is the readable part (empty without keepPrefix);
     * `atLineEnd` is true when a keepPrefix pattern's capture group 2 matched (the value ends its line);
     * `next` is the character right after the match (empty at the end of the text).
     */
    isSecret?: (value: string, prefix: string, atLineEnd: boolean, next: string) => boolean;
    /** When set, capture group 1 (a keyword, scheme or user) stays readable and only the rest is redacted. */
    keepPrefix?: boolean;
}
/**
 * The plugin's ONE secret list. The first block mirrors the API's list
 * (AgenticDevWorkflow packages/api/src/services/decisions/redact.ts) and runs first, so a glued pair
 * of tokens is taken whole before a looser pattern can split it; the second block is the plugin's
 * original list, kept as is so nothing it caught before is let through now.
 */
export declare const SECRET_PATTERNS: readonly SecretPattern[];
/** Scrub secret-shaped substrings out of a string, and report each value removed exactly as it was matched. */
export declare function redactStringWithRemoved(value: string): {
    text: string;
    removed: string[];
};
/** Scrub secret-shaped substrings out of a single free-text string. */
export declare function redactString(value: string): string;
/**
 * Walk the text by code point: a character is masked when any of its code units is, so a mask edge never
 * splits a surrogate pair or leaves half of one. Each run of masked characters becomes one marker, and the
 * text of each run is reported as removed.
 */
export declare function collapseMasked(text: string, mask: boolean[]): {
    text: string;
    runs: string[];
};
/**
 * Remove invisible and control characters (UNSAFE_CHARS) and lone surrogate halves, so a token split by one
 * is whole again before redaction: the stored view of cleanAndRedactWithRemoved.
 */
export declare function cleanText(value: string): string;
/**
 * Clean and redact, mirroring the API's decision redaction. Stripping invisible characters rejoins a token
 * they split, but it can also glue a word onto the key after it ("word" + U+3164 + "sk-..." reads
 * "wordsk-...", which the letter look-behinds refuse). So the patterns run on both views: a code unit is
 * masked when either finds it, by position, so another copy of a value in ordinary text is left alone.
 * Each run of masked units becomes one [REDACTED] (two secrets that touch become one). Text with no
 * invisible character comes out as redactString gives it.
 */
export declare function cleanAndRedactWithRemoved(value: string): {
    text: string;
    removed: string[];
};
/**
 * Deep-redact a context object: secret-shaped keys are fully masked, string
 * values are scrubbed, and arrays/nested objects are recursed into.
 */
export declare function redactSecrets(context: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=redaction.d.ts.map