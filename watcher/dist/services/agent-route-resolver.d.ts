/**
 * agent-route-resolver — per-agent routing decision for the model proxy.
 *
 * The proxy sees every request for the (opted-in) session. It decides per request where
 * to send it, based on a stable marker the routable agent carries in its system prompt:
 *
 *     OSS-ROUTE-AGENT: <agent-id>
 *
 * Resolution:
 *   - no models.agents configured              -> { route: 'anthropic' }  (pass-through)
 *   - no marker in the request                 -> { route: 'anthropic' }  (orchestrator)
 *   - marker present, mapped to ollama/<model> -> { route: 'ollama', model: '<model>' }
 *   - marker present, mapped to claude/default  -> { route: 'anthropic' }
 *
 * The DEFAULT is always Anthropic pass-through, so anything that is not explicitly a
 * local-mapped agent stays on cloud Claude. Users with no models.agents are unaffected.
 */
export interface RouteConfig {
    models?: {
        default?: string;
        agents?: Record<string, string>;
    };
}
export interface RouteDecision {
    route: 'ollama' | 'anthropic';
    /** Bare provider model name (e.g. "gpt-oss:120b") when route === 'ollama'. */
    model?: string;
    provider?: 'ollama';
    /** The agent id extracted from the marker, when present. */
    agent?: string;
}
/**
 * Decide where to route a request. Pure function — no I/O.
 */
export declare function resolveRoute(requestBody: {
    system?: unknown;
} | null | undefined, config: RouteConfig | null | undefined): RouteDecision;
//# sourceMappingURL=agent-route-resolver.d.ts.map