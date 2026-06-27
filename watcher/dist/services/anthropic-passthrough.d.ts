/**
 * anthropic-passthrough — forward a request to the real Anthropic API unchanged.
 *
 * Used by the proxy for every request that is NOT diverted to a local model: the
 * orchestrator session and claude-mapped agents. The caller's authentication MUST be
 * preserved verbatim — DeepBlue authenticates with an OAuth bearer
 * (CLAUDE_CODE_OAUTH_TOKEN) in the `authorization` header, others use `x-api-key` — and
 * the model MUST NOT be rewritten. This is a faithful reverse proxy for ANY Anthropic path.
 */
export interface ForwardOptions {
    /** Request path including any query string, e.g. "/v1/messages?beta=true". */
    path: string;
    method: string;
    /** Inbound request headers (lower-cased keys). */
    headers: Record<string, string | string[] | undefined>;
    /** Raw request body (already buffered) or undefined for GET/HEAD. */
    body?: string | Buffer;
}
type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string | Buffer;
}) => Promise<unknown>;
/**
 * Forward a request to api.anthropic.com, copying only the auth/version headers verbatim.
 * Returns the upstream fetch Response (caller streams/pipes the body back).
 *
 * @param fetchImpl injectable fetch (defaults to global fetch) — for tests.
 */
export declare function forwardToAnthropic(opts: ForwardOptions, fetchImpl?: FetchLike): Promise<unknown>;
export {};
//# sourceMappingURL=anthropic-passthrough.d.ts.map