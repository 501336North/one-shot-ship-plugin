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
import { resolveRoute, type RouteConfig } from './agent-route-resolver.js';

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

function fallbackEnabled(config: RouteConfig & { models?: { fallbackEnabled?: boolean } }): boolean {
  // Default ON — fallback is the safety net.
  return config?.models?.fallbackEnabled !== false;
}

export async function routeMessages(
  requestBody: { system?: unknown },
  config: RouteConfig & { models?: { fallbackEnabled?: boolean } },
  deps: RouteDeps
): Promise<RouteOutcome> {
  const decision = resolveRoute(requestBody, config);

  if (decision.route === 'ollama' && decision.model) {
    try {
      const result = await deps.ollamaHandle(decision.model, requestBody);
      deps.log({ agent: decision.agent, model: decision.model, route: 'ollama' });
      return { route: 'ollama', result };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!fallbackEnabled(config)) {
        deps.log({ agent: decision.agent, model: decision.model, route: 'ollama', reason: `error (no fallback): ${reason}` });
        throw err;
      }
      const result = await deps.passthrough(requestBody);
      deps.log({ agent: decision.agent, model: decision.model, route: 'anthropic', fallback: true, reason });
      return { route: 'anthropic', fellBack: true, result };
    }
  }

  // Anthropic pass-through (orchestrator, claude-mapped, or unmarked).
  const result = await deps.passthrough(requestBody);
  deps.log({ agent: decision.agent, route: 'anthropic' });
  return { route: 'anthropic', result };
}
