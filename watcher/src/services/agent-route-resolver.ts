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

/** Matches `OSS-ROUTE-AGENT: <id>` anywhere in the system prompt. */
const MARKER_RE = /OSS-ROUTE-AGENT:\s*([A-Za-z0-9:_-]+)/;

const OLLAMA_PREFIX = 'ollama/';

/**
 * Flatten an Anthropic `system` field (string | array of text blocks | undefined)
 * into a single searchable string.
 */
function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((block) =>
        block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : ''
      )
      .join('\n');
  }
  return '';
}

/**
 * Decide where to route a request. Pure function — no I/O.
 */
export function resolveRoute(
  requestBody: { system?: unknown } | null | undefined,
  config: RouteConfig | null | undefined
): RouteDecision {
  const agents = config?.models?.agents;
  // No per-agent mapping at all → pass everything through to Anthropic.
  if (!agents || Object.keys(agents).length === 0) {
    return { route: 'anthropic' };
  }

  const systemText = extractSystemText(requestBody?.system);
  const match = systemText.match(MARKER_RE);
  if (!match) {
    return { route: 'anthropic' };
  }

  const agent = match[1];
  const mapped = agents[agent];
  if (!mapped) {
    // Marked agent with no explicit mapping → pass through (and surface the agent for logging).
    return { route: 'anthropic', agent };
  }

  if (mapped.startsWith(OLLAMA_PREFIX)) {
    return {
      route: 'ollama',
      provider: 'ollama',
      model: mapped.slice(OLLAMA_PREFIX.length),
      agent,
    };
  }

  // Mapped to claude / default / any non-ollama target → Anthropic pass-through.
  return { route: 'anthropic', agent };
}
