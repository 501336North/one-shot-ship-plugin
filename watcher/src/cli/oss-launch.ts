/**
 * oss-launch — launcher entrypoint that transparently routes a Claude session through
 * the OSS model proxy, but ONLY when per-agent local routing is configured.
 *
 * Decision (resolveLaunch, pure):
 *   - models.agents configured  -> route through the proxy: set ANTHROPIC_BASE_URL +
 *     OSS_PROXY_ROUTING=1, caller starts/reuses the proxy, then execs the real claude.
 *   - models.agents absent/empty -> DO NOTHING: exec the real claude with the env
 *     UNCHANGED. Users on solely Anthropic models with no local models are unaffected.
 *
 * The exec wrapper (resolving the real claude binary, starting the proxy, spawning) is
 * built on top of this pure decision in later tasks (T14/T15).
 */

export interface LaunchConfig {
  models?: {
    agents?: Record<string, string>;
    proxyPort?: number;
  };
}

export interface LaunchDecision {
  /** Whether to route the session through the OSS proxy. */
  useProxy: boolean;
  /** Proxy port (only meaningful when useProxy is true). */
  port?: number;
  /** The environment to hand to the real claude process. */
  env: NodeJS.ProcessEnv;
}

/** Default proxy port — must match agent-model-check / start-proxy (NOT 3456; collides with CCR). */
export const DEFAULT_PROXY_PORT = 8473;

/**
 * Decide how to launch claude. Pure function — no spawning, no I/O.
 *
 * When no agents are mapped, returns the base env UNCHANGED (same reference) so the
 * launched claude is byte-for-byte identical to running `claude` directly.
 */
export function resolveLaunch(
  config: LaunchConfig | null | undefined,
  baseEnv: NodeJS.ProcessEnv
): LaunchDecision {
  const agents = config?.models?.agents;
  const hasAgents = !!agents && Object.keys(agents).length > 0;

  if (!hasAgents) {
    // Opt-out path: do not touch the environment at all.
    return { useProxy: false, env: baseEnv };
  }

  const envPort = baseEnv.OSS_PROXY_PORT ? Number(baseEnv.OSS_PROXY_PORT) : undefined;
  const port =
    (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
    config?.models?.proxyPort ??
    DEFAULT_PROXY_PORT;

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    OSS_PROXY_ROUTING: '1',
  };

  return { useProxy: true, port, env };
}

// ============================================================================
// Exec wrapper
// ============================================================================

interface SpawnedChild {
  on(event: string, cb: (arg: unknown) => void): unknown;
}

export interface LaunchDeps {
  /** Read the merged OSS config (project > user). */
  loadConfig: () => LaunchConfig;
  /** Ensure the proxy is reachable on `port` (reuse if healthy, start if down). */
  ensureProxy: (port: number) => Promise<void>;
  /** Resolve the REAL claude binary (never this launcher — avoid self-recursion). */
  resolveClaudeBin: () => string;
  /** Spawn the child process (claude). */
  spawn: (
    bin: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv; stdio: 'inherit' }
  ) => SpawnedChild;
  /** Base environment to start from. */
  baseEnv: NodeJS.ProcessEnv;
}

/**
 * Launch claude, routing through the proxy only when models.agents is configured.
 * Resolves to the child's exit code.
 */
export async function runLaunch(argv: string[], deps: LaunchDeps): Promise<number> {
  const decision = resolveLaunch(deps.loadConfig(), deps.baseEnv);

  if (decision.useProxy && decision.port !== undefined) {
    await deps.ensureProxy(decision.port);
  }

  const bin = deps.resolveClaudeBin();
  const child = deps.spawn(bin, argv, { env: decision.env, stdio: 'inherit' });

  return new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 0));
    child.on('error', () => resolve(1));
  });
}
