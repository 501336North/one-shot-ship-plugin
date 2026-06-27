/**
 * proxy-router — per-agent dispatch + fallback orchestration for the model proxy.
 *
 * Pure orchestration over injected collaborators (no HTTP here, so it's deterministically
 * testable). model-proxy wires the real collaborators: `ollamaHandle` (transform + call the
 * Ollama backend) and `passthrough` (forward to api.anthropic.com with the caller's auth).
 *
 * Decision uses resolveRoute (marker -> models.agents). Fallback: if the Ollama route throws
 * and fallbackEnabled (default true), retry via Anthropic pass-through. Every decision and
 * every fallback is logged loudly so a degrade can never silently look like success.
 */
import { type RouteConfig } from './agent-route-resolver.js';
export interface RouteLogEntry {
    agent?: string;
    model?: string;
    route: 'ollama' | 'anthropic';
    fallback?: boolean;
    reason?: string;
}
export interface RouteDeps {
    /** Transform + call the Ollama backend for `model`; returns the upstream result. */
    ollamaHandle: (model: string, requestBody: unknown) => Promise<unknown>;
    /** Forward the request to api.anthropic.com (auth preserved); returns the upstream result. */
    passthrough: (requestBody: unknown) => Promise<unknown>;
    /** Loud, always-on route log. */
    log: (entry: RouteLogEntry) => void;
}
export interface RouteOutcome {
    route: 'ollama' | 'anthropic';
    fellBack?: boolean;
    result: unknown;
}
export declare function routeMessages(requestBody: {
    system?: unknown;
}, config: RouteConfig & {
    models?: {
        fallbackEnabled?: boolean;
    };
}, deps: RouteDeps): Promise<RouteOutcome>;
//# sourceMappingURL=proxy-router.d.ts.map