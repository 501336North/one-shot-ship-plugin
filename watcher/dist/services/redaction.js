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
const hasDigit = (match) => /[0-9]/.test(match);
/**
 * At least 6 characters, and quoted, assigned with = (or =>), given to a --flag, alone at the end of its
 * line after :, or holding a digit ("TOKEN=v2" and "Password: see vault" stay). A bare scheme word followed
 * by whitespace ("token=Bearer <token>") is declined, so the Bearer/Basic patterns take the scheme and token.
 */
const isAssignedSecret = (value, prefix, atLineEnd, next) => !(/^(?:bearer|basic)$/i.test(value) && /\s/.test(next)) &&
    value.length >= 6 &&
    (/["'=>]\s*$/.test(prefix) || prefix.startsWith('--') || (atLineEnd && /:\s*$/.test(prefix)) || hasDigit(value));
/**
 * Key names that hold a secret: DB_PASS, pwd, x-api-key, STRIPE_KEY, CREDENTIALS, ..., plus up to two
 * suffix segments (SECRET_KEY_BASE, DB_PASSWORD_PROD_EU). PASS may follow any name (MYSQLPASS, DB_PASS),
 * except the English words bypass, compass, overpass, underpass, surpass and trespass.
 */
const SECRET_KEY_NAME = '(?:PASSWORD|PASSWD|PASSPHRASE|(?<!by|com|over|under|sur|tres)PASS|PWD|SECRET|TOKEN|CREDENTIALS|(?:API|SECRET|PRIVATE|ACCESS|SIGNING|ENCRYPTION|[_-])KEY)(?:[_-][A-Za-z0-9]+){0,2}';
/**
 * True when a dotted run holds header.payload.signature with the JWT shape (eyJ + 10 chars, a segment
 * starting eyJ with 10 more chars, then 10 chars). Checked by splitting, so "eyJeyJeyJ..." stays linear.
 */
function hasJwtShape(run) {
    const segments = run.split('.');
    for (let i = 0; i + 2 < segments.length; i++) {
        const header = segments[i];
        const start = header.indexOf('eyJ');
        if (start !== -1 &&
            header.length - start >= 13 &&
            segments[i + 1].startsWith('eyJ') &&
            segments[i + 1].length >= 13 &&
            segments[i + 2].length >= 10) {
            return true;
        }
    }
    return false;
}
/**
 * The plugin's ONE secret list. The first block mirrors the API's list
 * (AgenticDevWorkflow packages/api/src/services/decisions/redact.ts) and runs first, so a glued pair
 * of tokens is taken whole before a looser pattern can split it; the second block is the plugin's
 * original list, kept as is so nothing it caught before is let through now.
 */
export const SECRET_PATTERNS = [
    // RSA/EC/OPENSSH/ENCRYPTED/PGP; through END, or to the end of the text when there is no END.
    {
        name: 'private-key-block',
        pattern: /----- *BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)? *-----[\s\S]*?(?:----- *END [A-Z ]*PRIVATE KEY(?: BLOCK)? *-----|$)/gi,
    },
    // The whole dotted run is redacted, so two glued JWTs go together and no fragment survives.
    { name: 'jwt', pattern: /eyJ[A-Za-z0-9_.-]*/g, isSecret: hasJwtShape },
    { name: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/g },
    { name: 'github-fine-grained-pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
    { name: 'github-token', pattern: /gh[pousr]_(?:(?!gh[pousr]_)[A-Za-z0-9]){20,}/g },
    { name: 'stripe-key', pattern: /[rs]k_(?:live|test)_(?:(?![rs]k_(?:live|test)_)[A-Za-z0-9]){16,}/g },
    { name: 'aws-access-key-id', pattern: /A[KS]IA[0-9A-Z]{16}/g },
    { name: 'npm-token', pattern: /npm_[A-Za-z0-9]{36}/g },
    { name: 'gitlab-pat', pattern: /glpat-[A-Za-z0-9_-]{20,}/g },
    { name: 'slack-app-token', pattern: /xapp-[A-Za-z0-9-]+/g },
    { name: 'slack-token', pattern: /(?:xoxe\.)?xox[abeprs]-[A-Za-z0-9-]+/g },
    { name: 'oss-api-key', pattern: /ak_[0-9a-f]{64}/g },
    {
        // The user may be empty (redis://:pw@host) and the password may hold / or @, so it runs to the
        // LAST @ before the host. The cap keeps a long run of "a://:a://:..." linear.
        name: 'connection-string-password',
        pattern: /([a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]*:)\S{1,256}(?=@)/gi,
        keepPrefix: true,
    },
    {
        // A secret-named key, then :, =, =>, :=, ?= or +=, or a --flag. The value decides, not the key: a
        // quoted value (taken whole, \" escapes included), a value after = or a --flag, a lone value ending its
        // line after :, or one holding a digit is a secret; anything else is prose ("Password: see vault").
        // Group 2 is set when the value ends its line. An unquoted value runs to the next space or quote, & included
        // (as in the API): a secret may itself hold "&k=", so ?api_key=x&foo=bar loses foo=bar on purpose.
        name: 'secret-assignment',
        pattern: new RegExp(`((?<![A-Za-z0-9_-])(?:--[A-Za-z0-9_-]*${SECRET_KEY_NAME}\\s+|[A-Za-z0-9_-]*${SECRET_KEY_NAME}["']?\\s*(?:[:?+]?=>?|:)\\s*)["']?)(?:(?<=")(?:[^"\\\\\\n]|\\\\.)+(?=")|(?<=')(?:[^'\\\\\\n]|\\\\.)+(?=')|[^\\s"']+)(?=([ \\t]*(?:\\n|$))|)`, 'gi'),
        isSecret: isAssignedSecret,
        keepPrefix: true,
    },
    { name: 'bearer-token', pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, keepPrefix: true },
    {
        // After an Authorization (or Proxy-Authorization) key the value is always the credential. Elsewhere,
        // base64 of user:password nearly always holds a digit, + / or =; "Basic Authentication" does not.
        name: 'basic-auth',
        pattern: /((?:Authorization["']?[ \t]*[:=][ \t]*["']?)?Basic\s+)[A-Za-z0-9+/]{12,}={0,2}/gi,
        isSecret: (value, prefix) => /^Authorization/i.test(prefix) || /[0-9+/=]/.test(value),
        keepPrefix: true,
    },
    { name: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/]+/g },
    { name: 'discord-webhook', pattern: /https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/(?:v[0-9]+\/)?webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g },
    { name: 'google-oauth-token', pattern: /ya29\.(?:(?!ya29\.)[A-Za-z0-9_-]){20,}/g },
    { name: 'sendgrid-key', pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
    { name: 'stripe-webhook-secret', pattern: /whsec_(?:(?!whsec_)[A-Za-z0-9+/=]){32,}/g },
    { name: 'huggingface-token', pattern: /hf_(?:(?!hf_)[A-Za-z0-9]){34,}/g },
    { name: 'telegram-bot-token', pattern: /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g },
    // sk- refuses only a preceding letter: without it "task-runner-v2-..." would match; "9sk-..." is a glued key.
    { name: 'sk-api-key', pattern: /(?<![A-Za-z])sk-[A-Za-z0-9_-]{20,}/g, isSecret: hasDigit },
    // --- the plugin's original list ---
    // Anthropic + generic `sk-` style keys (sk-ant-..., sk-...)
    { name: 'sk-key', pattern: /sk-[A-Za-z0-9_-]{12,}/g },
    // Authorization header, ANY scheme (Bearer, Basic, Digest, Token, ...)
    { name: 'authorization-header', pattern: /Authorization:\s*[A-Za-z]+\s+[^\s"']+/gi },
    // Bare bearer token
    { name: 'bare-bearer', pattern: /Bearer\s+[^\s"']+/g },
    // JWTs: three base64url segments
    { name: 'jwt-segments', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
    // Query-string / form secret params (access_token before token to win leftmost)
    { name: 'secret-param', pattern: /(?:api[_-]?key|access[_-]?token|token|secret|password)=[^\s"'&]+/gi },
    // GitHub personal access tokens
    { name: 'ghp', pattern: /ghp_[A-Za-z0-9]{20,}/g },
    // AWS access key IDs
    { name: 'akia', pattern: /AKIA[A-Z0-9]{12,}/g },
    // Slack bot/user tokens
    { name: 'slack-bot-user', pattern: /xox[bp]-[A-Za-z0-9-]+/g },
    // Google API keys
    { name: 'google-api-key-legacy', pattern: /AIza[A-Za-z0-9_-]{20,}/g },
];
/** Keys whose values are secrets regardless of shape (apiKey-like). */
const SECRET_KEY_PATTERN = /api[_-]?key|secret|token|password/i;
/** Scrub secret-shaped substrings out of a string, and report each value removed exactly as it was matched. */
export function redactStringWithRemoved(value) {
    const removed = [];
    let text = value;
    for (const { pattern, isSecret, keepPrefix } of SECRET_PATTERNS) {
        text = text.replace(pattern, (match, ...groups) => {
            const prefix = keepPrefix ? String(groups[0]) : '';
            const atLineEnd = keepPrefix === true && typeof groups[1] === 'string';
            const next = String(groups[groups.length - 1]).charAt(Number(groups[groups.length - 2]) + match.length);
            const secret = match.slice(prefix.length);
            if (isSecret && !isSecret(secret, prefix, atLineEnd, next))
                return match;
            removed.push(secret);
            return `${prefix}[REDACTED]`;
        });
    }
    return { text, removed };
}
/** Scrub secret-shaped substrings out of a single free-text string. */
export function redactString(value) {
    return redactStringWithRemoved(value).text;
}
// C0 controls but tab and newline, DEL, C1, the bidi marks, and the invisible characters that split a
// token when text is copied from chat or docs (soft hyphen, zero-width space/joiners, word joiner, BOM).
// Mirrors the API's cleanText, which runs before its redaction.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
/** Remove invisible and control characters, so a token split by one is whole again before redaction. */
export function cleanText(value) {
    return value.replace(UNSAFE_CHARS, '');
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