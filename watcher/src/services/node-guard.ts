/**
 * node-guard — preflight that Node is present and new enough.
 *
 * The launcher/offload paths shell out to `node`. If Node is missing or too old (the exact
 * gap that silently broke local routing on DeepBlue), fail LOUDLY rather than letting the
 * session run all-cloud with no signal.
 */

export interface NodeCheck {
  ok: boolean;
  major?: number;
  message?: string;
}

/**
 * @param version e.g. process.version ("v20.11.0"), or undefined if node couldn't be run.
 * @param minMajor minimum required major version. Default 20 (LTS): the dist relies on
 *   web ReadableStream + Readable.fromWeb + global fetch, all stable from Node 20.
 */
export function checkNode(version: string | undefined, minMajor = 20): NodeCheck {
  if (!version) {
    return {
      ok: false,
      message:
        'Node.js was not found. Local model routing requires Node >= ' +
        minMajor +
        '. Install Node and retry (e.g. via your version manager).',
    };
  }
  const m = version.match(/v?(\d+)\./);
  const major = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(major) || major < minMajor) {
    return {
      ok: false,
      major: Number.isFinite(major) ? major : undefined,
      message: `Node.js ${version} is too old; local model routing requires Node >= ${minMajor}.`,
    };
  }
  return { ok: true, major };
}

export interface PreflightInput {
  /** Result of checkNode(process.version) on the runtime about to route. */
  nodeCheck: NodeCheck;
  /** Whether per-agent local routing is configured (models.agents non-empty). */
  routingConfigured: boolean;
}

export interface PreflightDecision {
  /** Route through the proxy (true) or run the real claude all-cloud (false). */
  route: boolean;
  /** Loud message to surface when we refuse to route — only set when route is false. */
  banner?: string;
}

/**
 * Decide whether to route through the proxy or degrade to all-cloud — LOUDLY, never silently.
 *
 * - routing NOT configured → always route (no proxy is engaged anyway); never warn. This preserves
 *   the no-impact guarantee for users who don't use local models, regardless of Node state.
 * - routing configured + Node usable → route.
 * - routing configured + Node missing/too old → do NOT route; return a loud banner so the operator
 *   sees the degrade. (The launcher still execs claude all-cloud so work is never blocked.)
 */
export function decidePreflight(input: PreflightInput): PreflightDecision {
  if (!input.routingConfigured) return { route: true };
  if (input.nodeCheck.ok) return { route: true };

  const reason = input.nodeCheck.message ?? 'Node is unavailable.';
  return {
    route: false,
    banner:
      `⚠️  OSS: local model routing DISABLED — running ALL-CLOUD. ${reason} ` +
      `Install/upgrade Node (or unset models.agents) to route agents locally.`,
  };
}
