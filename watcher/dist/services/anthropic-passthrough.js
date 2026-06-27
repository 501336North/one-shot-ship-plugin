/**
 * anthropic-passthrough — forward a request to the real Anthropic API unchanged.
 *
 * Used by the proxy for every request that is NOT diverted to a local model: the
 * orchestrator session and claude-mapped agents. The caller's authentication MUST be
 * preserved verbatim — DeepBlue authenticates with an OAuth bearer
 * (CLAUDE_CODE_OAUTH_TOKEN) in the `authorization` header, others use `x-api-key` — and
 * the model MUST NOT be rewritten. This is a faithful reverse proxy for ANY Anthropic path.
 */
const ANTHROPIC_BASE = 'https://api.anthropic.com';
/** Inbound headers we forward upstream. Everything else (host, content-length, connection…) is dropped. */
const FORWARD_HEADERS = [
    'authorization',
    'x-api-key',
    'anthropic-version',
    'anthropic-beta',
    'anthropic-dangerous-direct-browser-access',
    'content-type',
    'accept',
    'user-agent',
];
/**
 * Forward a request to api.anthropic.com, copying only the auth/version headers verbatim.
 * Returns the upstream fetch Response (caller streams/pipes the body back).
 *
 * @param fetchImpl injectable fetch (defaults to global fetch) — for tests.
 */
export function forwardToAnthropic(opts, fetchImpl = globalThis.fetch) {
    const url = `${ANTHROPIC_BASE}${opts.path}`;
    const headers = {};
    for (const name of FORWARD_HEADERS) {
        const v = opts.headers[name];
        if (v === undefined)
            continue;
        headers[name] = Array.isArray(v) ? v.join(', ') : v;
    }
    const init = {
        method: opts.method,
        headers,
    };
    if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'HEAD') {
        init.body = opts.body;
    }
    return fetchImpl(url, init);
}
//# sourceMappingURL=anthropic-passthrough.js.map