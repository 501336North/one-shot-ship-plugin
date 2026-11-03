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
        // LAST @ before the host. The cap keeps a long run of "a://:a://:..." linear. A run of NULs (a token that
        // cleanAndRedactWithRemoved's mask already covers) counts as one character, as the shorter [REDACTED]
        // does in redactString, so the cap cannot stop short of the @ and leave the rest of the password readable.
        name: 'connection-string-password',
        // eslint-disable-next-line no-control-regex -- the NUL is maskOf's placeholder, matched on purpose
        pattern: /([a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]*:)(?:\u0000+(?!\u0000)|[^\s\u0000]){1,256}(?=@)/gi,
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
const MARKER = '[REDACTED]';
/**
 * Run every pattern in order and replace each secret value found (a kept prefix stays), reporting each value
 * exactly as it was matched. Later patterns see the text the earlier replacements left.
 */
function applySecretPatterns(value, replace) {
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
            return `${prefix}${replace(secret)}`;
        });
    }
    return { text, removed };
}
/** Scrub secret-shaped substrings out of a string, and report each value removed exactly as it was matched. */
export function redactStringWithRemoved(value) {
    return applySecretPatterns(value, () => MARKER);
}
/** Scrub secret-shaped substrings out of a single free-text string. */
export function redactString(value) {
    return redactStringWithRemoved(value).text;
}
// The shared invisible-character list, mirrored exactly in the API's cleanText (AgenticDevWorkflow
// packages/api/src/services/decisions/redact.ts), which runs before its redaction. Change both together.
// C0 controls but tab and newline, DEL, C1, every format character (\p{Cf}: soft hyphen, bidi marks,
// zero-width space/joiners, word joiner, invisible operators, BOM, tags), every default-ignorable code
// point (combining grapheme joiner, Hangul fillers, variation selectors, reserved ignorables), and the
// Braille blank (U+2800, not default-ignorable): each can split a token when text is copied from chat
// or docs.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
// maskOf's placeholder for a secret code unit. Neither view holds a NUL: both drop the C0 controls.
const NUL = String.fromCharCode(0);
const NUL_RUN = new RegExp(`${NUL}+`, 'g');
/** A C0 control but TAB and LF, DEL, or a C1 control: removed from both views. */
function isControl(code) {
    return code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
/** True when the text holds a surrogate half that is not part of a pair. */
function hasLoneSurrogate(value) {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (isHighSurrogate(code) && i + 1 < value.length && isLowSurrogate(value.charCodeAt(i + 1)))
            i++;
        else if (isHighSurrogate(code) || isLowSurrogate(code))
            return true;
    }
    return false;
}
/**
 * Build both views. A lone surrogate half is a U+FFFD in the kept view and gone from the stored view; it is
 * never left in place, so stripping the character between two halves cannot join them into a new code point
 * (such as an invisible tag). A U+FFFD that was already in the input is visible text and is kept in both.
 */
function buildViews(value) {
    const kept = [];
    const fromLoneHalf = new Set();
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (isHighSurrogate(code) && i + 1 < value.length && isLowSurrogate(value.charCodeAt(i + 1))) {
            kept.push(value[i], value[i + 1]);
            i++;
        }
        else if (isHighSurrogate(code) || isLowSurrogate(code)) {
            fromLoneHalf.add(kept.length);
            kept.push(REPLACEMENT_CHAR);
        }
        else if (!isControl(code)) {
            kept.push(value[i]);
        }
    }
    const keptText = kept.join('');
    let stored = '';
    const storedFromKept = [];
    for (let i = 0; i < keptText.length;) {
        const char = String.fromCodePoint(keptText.codePointAt(i));
        if (!fromLoneHalf.has(i) && !UNSAFE_CHARS.test(char)) {
            stored += char;
            for (let unit = 0; unit < char.length; unit++)
                storedFromKept.push(i + unit);
        }
        i += char.length;
    }
    return { kept: keptText, stored, storedFromKept };
}
/**
 * Run the patterns on a view in redaction order, but put a NUL in place of each code unit of a secret value
 * (so later patterns see a text of the same length), and return a per-code-unit mask: true = secret.
 */
function maskOf(view) {
    const { text, removed } = applySecretPatterns(view, (secret) => NUL.repeat(secret.length));
    const mask = [];
    for (let i = 0; i < text.length; i++)
        mask.push(text.charCodeAt(i) === 0);
    // A value that held an earlier secret is reported as redaction would report it, with the marker in place.
    return { mask, removed: removed.map((secret) => secret.replace(NUL_RUN, MARKER)) };
}
/**
 * Walk the text by code point: a character is masked when any of its code units is, so a mask edge never
 * splits a surrogate pair or leaves half of one. Each run of masked characters becomes one marker, and the
 * text of each run is reported as removed.
 */
export function collapseMasked(text, mask) {
    let out = '';
    let run = '';
    const runs = [];
    for (let i = 0; i < text.length;) {
        const char = String.fromCodePoint(text.codePointAt(i));
        const masked = mask[i] || (char.length === 2 && mask[i + 1]);
        if (masked) {
            run += char;
        }
        else {
            if (run !== '') {
                runs.push(run);
                out += MARKER;
                run = '';
            }
            out += char;
        }
        i += char.length;
    }
    if (run !== '') {
        runs.push(run);
        out += MARKER;
    }
    return { text: out, runs };
}
/**
 * Remove invisible and control characters (UNSAFE_CHARS) and lone surrogate halves, so a token split by one
 * is whole again before redaction: the stored view of cleanAndRedactWithRemoved.
 */
export function cleanText(value) {
    return buildViews(value).stored;
}
/**
 * Clean and redact, mirroring the API's decision redaction. Stripping invisible characters rejoins a token
 * they split, but it can also glue a word onto the key after it ("word" + U+3164 + "sk-..." reads
 * "wordsk-...", which the letter look-behinds refuse). So the patterns run on both views: a code unit is
 * masked when either finds it, by position, so another copy of a value in ordinary text is left alone.
 * Each run of masked units becomes one [REDACTED] (two secrets that touch become one). Text with no
 * invisible character comes out as redactString gives it.
 */
export function cleanAndRedactWithRemoved(value) {
    // Fast path: text with no control (but TAB and LF), no invisible character and no lone half goes through the
    // plain redaction unchanged, so plain text, touching secrets included, comes out exactly as before.
    if (!UNSAFE_CHARS.test(value) && !hasLoneSurrogate(value))
        return redactStringWithRemoved(value);
    const { kept, stored, storedFromKept } = buildViews(value);
    const keptMask = maskOf(kept).mask;
    const storedScan = maskOf(stored);
    const mask = storedFromKept.map((keptIndex, i) => keptMask[keptIndex] || storedScan.mask[i]);
    const { text, runs } = collapseMasked(stored, mask);
    return { text, removed: [...storedScan.removed, ...runs] };
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