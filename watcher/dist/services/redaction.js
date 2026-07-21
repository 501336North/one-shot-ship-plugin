/**
 * Shared secret redaction — the single implementation used by the emitter
 * (oss-error.ts) and every consumer-side path (generator.ts, log-monitor.ts)
 * so a secret never survives into a sink or a queue-task prompt (defense in depth).
 *
 * All patterns are linear (bounded character classes, no nested quantifiers) to
 * avoid catastrophic backtracking on adversarial input.
 */
/** Value patterns matched anywhere inside a free-text string. */
const SECRET_VALUE_PATTERNS = [
    // Anthropic + generic `sk-` style keys (sk-ant-..., sk-...)
    /sk-[A-Za-z0-9_-]{12,}/g,
    // Authorization header, ANY scheme (Bearer, Basic, Digest, Token, ...)
    /Authorization:\s*[A-Za-z]+\s+[^\s"']+/gi,
    // Bare bearer token
    /Bearer\s+[^\s"']+/g,
    // JWTs: three base64url segments
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    // Query-string / form secret params (access_token before token to win leftmost)
    /(?:api[_-]?key|access[_-]?token|token|secret|password)=[^\s"'&]+/gi,
    // GitHub personal access tokens
    /ghp_[A-Za-z0-9]{20,}/g,
    // AWS access key IDs
    /AKIA[A-Z0-9]{12,}/g,
    // Slack bot/user tokens
    /xox[bp]-[A-Za-z0-9-]+/g,
    // Google API keys
    /AIza[A-Za-z0-9_-]{20,}/g,
];
/** Keys whose values are secrets regardless of shape (apiKey-like). */
const SECRET_KEY_PATTERN = /api[_-]?key|secret|token|password/i;
/** Scrub secret-shaped substrings out of a single free-text string. */
export function redactString(value) {
    let out = value;
    for (const pattern of SECRET_VALUE_PATTERNS) {
        out = out.replace(pattern, '[REDACTED]');
    }
    return out;
}
function redactValue(value) {
    if (typeof value === 'string') {
        return redactString(value);
    }
    if (Array.isArray(value)) {
        return value.map(redactValue);
    }
    if (typeof value === 'object' && value !== null) {
        return redactSecrets(value);
    }
    return value;
}
/**
 * Deep-redact a context object: secret-shaped keys are fully masked, string
 * values are scrubbed, and arrays/nested objects are recursed into.
 */
export function redactSecrets(context) {
    const out = {};
    for (const [key, value] of Object.entries(context)) {
        out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactValue(value);
    }
    return out;
}
//# sourceMappingURL=redaction.js.map