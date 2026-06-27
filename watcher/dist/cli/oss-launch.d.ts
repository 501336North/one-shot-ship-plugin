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
import { type NodeCheck } from '../services/node-guard.js';
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
export declare const DEFAULT_PROXY_PORT = 8473;
/**
 * Decide how to launch claude. Pure function — no spawning, no I/O.
 *
 * When no agents are mapped, returns the base env UNCHANGED (same reference) so the
 * launched claude is byte-for-byte identical to running `claude` directly.
 */
export declare function resolveLaunch(config: LaunchConfig | null | undefined, baseEnv: NodeJS.ProcessEnv): LaunchDecision;
/** Route a leading `start-proxy` subcommand to the proxy entry; else it's a launch. */
export declare function resolveEntry(argv: string[]): 'start-proxy' | 'launch';
/** `oss-launch --version` / `-v`. */
export declare function isVersionRequest(argv: string[]): boolean;
/**
 * Build the argv for spawning the router proxy. A bundled binary re-invokes ITSELF with the
 * `start-proxy` subcommand (its own runtime — no system node); a node-script install spawns the
 * compiled `start-proxy.js`. In both cases the binary/node is `process.execPath` at the call site.
 */
export declare function proxySpawnArgs(opts: {
    bundled: boolean;
    startProxyJs: string;
    port: number;
}): string[];
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
    spawn: (bin: string, args: string[], opts: {
        env: NodeJS.ProcessEnv;
        stdio: 'inherit';
    }) => SpawnedChild;
    /** Base environment to start from. */
    baseEnv: NodeJS.ProcessEnv;
    /** Probe the runtime Node (defaults to ok). main() wires this to checkNode(process.version). */
    nodeCheck?: () => NodeCheck;
    /** Surface a loud degrade warning (defaults to console.error). */
    warn?: (msg: string) => void;
}
/**
 * Launch claude, routing through the proxy only when models.agents is configured.
 * Resolves to the child's exit code.
 */
export declare function runLaunch(argv: string[], deps: LaunchDeps): Promise<number>;
export interface ResolveClaudeBinDeps {
    /** Colon/`delimiter`-separated PATH to scan. */
    pathEnv: string;
    /** Absolute path of THIS launcher — any candidate resolving here is skipped (no self-exec). */
    selfPath: string;
    /** Does `p` exist and look executable? (fs.existsSync + executable bit) */
    isExecutable: (p: string) => boolean;
    /** Resolve symlinks so a `claude` symlinked to the launcher is detected. Default: identity. */
    realpath?: (p: string) => string;
    /** PATH delimiter (default ':') and dir separator (default '/'). */
    delimiter?: string;
    sep?: string;
}
/**
 * Find the real `claude` binary on PATH, NEVER resolving to this launcher.
 *
 * If the launcher is installed/symlinked as `claude` (so a user's `claude …` transparently
 * routes through the proxy), a naive PATH scan would find the launcher first and exec itself
 * forever. We skip any candidate whose realpath equals our own, and return the next real claude.
 */
export declare function resolveClaudeBin(deps: ResolveClaudeBinDeps): string;
export interface EnsureProxyDeps {
    /** GET http://127.0.0.1:<port>/health → true when the proxy is up. */
    healthCheck: (port: number) => Promise<boolean>;
    /** Start the proxy (spawn `start-proxy --router --background`, detached). */
    startProxy: () => void;
    /** Sleep between health polls. */
    sleep: (ms: number) => Promise<void>;
    /** Max health polls after start before giving up (default 40). */
    maxAttempts?: number;
    /** Poll interval in ms (default 250). */
    intervalMs?: number;
}
/**
 * Ensure the OSS proxy is reachable on `port`: reuse a healthy one, else start it and wait for
 * the bind. Throws loudly if it never comes up — we must NEVER silently fall through to an
 * all-cloud session when local routing was requested.
 */
export declare function ensureProxy(port: number, deps: EnsureProxyDeps): Promise<void>;
/**
 * Launcher entrypoint: build the real collaborators (config read, proxy health/start, claude
 * resolution, spawn) and run. Resolves to the child's exit code.
 */
export declare function main(argv: string[]): Promise<number | undefined>;
export {};
//# sourceMappingURL=oss-launch.d.ts.map