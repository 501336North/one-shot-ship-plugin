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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { checkNode, decidePreflight } from '../services/node-guard.js';
import * as startProxyModule from './start-proxy.js';
/** Default proxy port — must match agent-model-check / start-proxy (NOT 3456; collides with CCR). */
export const DEFAULT_PROXY_PORT = 8473;
/**
 * Decide how to launch claude. Pure function — no spawning, no I/O.
 *
 * When no agents are mapped, returns the base env UNCHANGED (same reference) so the
 * launched claude is byte-for-byte identical to running `claude` directly.
 */
export function resolveLaunch(config, baseEnv) {
    const agents = config?.models?.agents;
    const hasAgents = !!agents && Object.keys(agents).length > 0;
    if (!hasAgents) {
        // Opt-out path: do not touch the environment at all.
        return { useProxy: false, env: baseEnv };
    }
    const envPort = baseEnv.OSS_PROXY_PORT ? Number(baseEnv.OSS_PROXY_PORT) : undefined;
    const port = (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
        config?.models?.proxyPort ??
        DEFAULT_PROXY_PORT;
    const env = {
        ...baseEnv,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        OSS_PROXY_ROUTING: '1',
    };
    return { useProxy: true, port, env };
}
// ============================================================================
// Entry helpers — one bundled binary serves both launcher and proxy roles
// ============================================================================
/** Route a leading `start-proxy` subcommand to the proxy entry; else it's a launch. */
export function resolveEntry(argv) {
    return argv[0] === 'start-proxy' ? 'start-proxy' : 'launch';
}
/** `oss-launch --version` / `-v`. */
export function isVersionRequest(argv) {
    return argv.includes('--version') || argv.includes('-v');
}
/**
 * Build the argv for spawning the router proxy. A bundled binary re-invokes ITSELF with the
 * `start-proxy` subcommand (its own runtime — no system node); a node-script install spawns the
 * compiled `start-proxy.js`. In both cases the binary/node is `process.execPath` at the call site.
 */
export function proxySpawnArgs(opts) {
    const head = opts.bundled ? ['start-proxy'] : [opts.startProxyJs];
    return [...head, '--router', '--background', '--port', String(opts.port)];
}
/**
 * Launch claude, routing through the proxy only when models.agents is configured.
 * Resolves to the child's exit code.
 */
export async function runLaunch(argv, deps) {
    const decision = resolveLaunch(deps.loadConfig(), deps.baseEnv);
    // Node preflight: only meaningful when routing is configured. If Node is missing/too old we
    // degrade to all-cloud LOUDLY (never silently) and never block the user's work.
    const nodeCheck = (deps.nodeCheck ?? (() => ({ ok: true })))();
    const preflight = decidePreflight({ nodeCheck, routingConfigured: decision.useProxy });
    let env = decision.env;
    if (decision.useProxy && preflight.route && decision.port !== undefined) {
        await deps.ensureProxy(decision.port);
    }
    else if (decision.useProxy && !preflight.route) {
        (deps.warn ?? ((m) => console.error(m)))(preflight.banner ?? '');
        env = deps.baseEnv; // all-cloud: env UNCHANGED, no proxy
    }
    const bin = deps.resolveClaudeBin();
    const child = deps.spawn(bin, argv, { env, stdio: 'inherit' });
    return new Promise((resolve) => {
        child.on('close', (code) => resolve(typeof code === 'number' ? code : 0));
        child.on('error', () => resolve(1));
    });
}
/**
 * Find the real `claude` binary on PATH, NEVER resolving to this launcher.
 *
 * If the launcher is installed/symlinked as `claude` (so a user's `claude …` transparently
 * routes through the proxy), a naive PATH scan would find the launcher first and exec itself
 * forever. We skip any candidate whose realpath equals our own, and return the next real claude.
 */
export function resolveClaudeBin(deps) {
    const delimiter = deps.delimiter ?? ':';
    const sep = deps.sep ?? '/';
    const realpath = deps.realpath ?? ((p) => p);
    const selfReal = realpath(deps.selfPath);
    for (const dir of deps.pathEnv.split(delimiter)) {
        if (!dir)
            continue;
        const candidate = `${dir}${sep}claude`;
        if (!deps.isExecutable(candidate))
            continue;
        if (realpath(candidate) === selfReal)
            continue; // never exec ourselves
        return candidate;
    }
    throw new Error('Could not find the real `claude` binary on PATH (only the launcher itself).');
}
/**
 * Ensure the OSS proxy is reachable on `port`: reuse a healthy one, else start it and wait for
 * the bind. Throws loudly if it never comes up — we must NEVER silently fall through to an
 * all-cloud session when local routing was requested.
 */
export async function ensureProxy(port, deps) {
    if (await deps.healthCheck(port))
        return; // already up → reuse
    deps.startProxy();
    const maxAttempts = deps.maxAttempts ?? 40;
    const intervalMs = deps.intervalMs ?? 250;
    for (let i = 0; i < maxAttempts; i++) {
        await deps.sleep(intervalMs);
        if (await deps.healthCheck(port))
            return;
    }
    throw new Error(`OSS proxy did not become healthy on port ${port} after ${maxAttempts} attempts.`);
}
// ============================================================================
// Composition root — build real deps and exec claude (entrypoint)
// ============================================================================
/**
 * Read the merged OSS config (project `.oss/config.json` overrides user `~/.oss/config.json`),
 * returning only the `models` slice the launcher cares about. Best-effort: defaults to {} on any
 * error, so a missing/malformed config simply means "no routing" (Anthropic-only, untouched).
 */
function loadMergedConfig(fsImpl, pathImpl, osImpl) {
    const read = (file) => {
        try {
            if (fsImpl.existsSync(file))
                return JSON.parse(fsImpl.readFileSync(file, 'utf-8'));
        }
        catch {
            /* ignore malformed/unreadable config */
        }
        return null;
    };
    const userCfg = read(pathImpl.join(osImpl.homedir(), '.oss', 'config.json'));
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    const projectCfg = projectDir ? read(pathImpl.join(projectDir, '.oss', 'config.json')) : null;
    const merged = { ...(userCfg ?? {}), ...(projectCfg ?? {}) };
    return { models: merged.models };
}
/**
 * Launcher entrypoint: build the real collaborators (config read, proxy health/start, claude
 * resolution, spawn) and run. Resolves to the child's exit code.
 */
export async function main(argv) {
    // NOTE: static top-level imports (above) — NOT dynamic `await import()`. pkg's snapshot cannot
    // execute dynamic import() ("Invalid host defined options"), so the bundled binary requires these
    // to be require()-able. esbuild compiles the static imports to require in the .cjs bundle.
    const selfPath = (() => {
        try {
            return fs.realpathSync(process.argv[1] ?? fileURLToPath(import.meta.url));
        }
        catch {
            return process.argv[1] ?? '';
        }
    })();
    const startProxyJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'start-proxy.js');
    // Bundled binary (self-contained Node) vs a node-script install. Use the build-time flag injected
    // only into the esbuild bundle — robust vs guessing from process.execPath's basename (a system
    // Node named `nodejs`/`node20` would be misclassified).
    const bundled = typeof __OSS_BUNDLED__ !== 'undefined' && __OSS_BUNDLED__ === true;
    // The single binary doubles as the proxy: `oss-launch start-proxy …` runs start-proxy in-process.
    // Return `undefined` (NOT 0) so the entrypoint does NOT process.exit — a foreground proxy must
    // stay alive on its HTTP server; a `--background` run resolves and exits naturally.
    if (resolveEntry(argv) === 'start-proxy') {
        await startProxyModule.main(argv.slice(1));
        return undefined;
    }
    // `oss-launch --version`. Prefer the build-time embedded version (set by esbuild `define` in the
    // bundle) — a relocated binary in ~/.oss/bin can't resolve plugin.json by relative path. Fall back
    // to reading the manifest for the node-script install.
    if (isVersionRequest(argv)) {
        let version = typeof __OSS_LAUNCH_VERSION__ !== 'undefined' && __OSS_LAUNCH_VERSION__ ? __OSS_LAUNCH_VERSION__ : 'unknown';
        if (version === 'unknown') {
            try {
                const manifest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.claude-plugin', 'plugin.json');
                version = JSON.parse(fs.readFileSync(manifest, 'utf-8')).version ?? version;
            }
            catch {
                /* best-effort */
            }
        }
        console.log(`oss-launch ${version}`);
        return 0;
    }
    const healthCheck = (port) => new Promise((resolve) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
            res.resume();
            resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
    const deps = {
        loadConfig: () => loadMergedConfig(fs, path, os),
        ensureProxy: (port) => ensureProxy(port, {
            healthCheck,
            startProxy: () => {
                const child = spawn(process.execPath, proxySpawnArgs({ bundled, startProxyJs, port }), { detached: true, stdio: 'ignore' });
                child.unref();
            },
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        }),
        resolveClaudeBin: () => resolveClaudeBin({
            pathEnv: process.env.PATH ?? '',
            selfPath,
            isExecutable: (p) => {
                try {
                    fs.accessSync(p, fs.constants.X_OK);
                    return fs.statSync(p).isFile();
                }
                catch {
                    return false;
                }
            },
            realpath: (p) => {
                try {
                    return fs.realpathSync(p);
                }
                catch {
                    return p;
                }
            },
            delimiter: path.delimiter,
            sep: path.sep,
        }),
        spawn: (bin, args, opts) => spawn(bin, args, opts),
        baseEnv: process.env,
        // The bundled binary ships its OWN runtime — trust it (the floor check exists only to catch a
        // bad SYSTEM node on the fallback path). Only probe process.version when running via system node.
        nodeCheck: () => (bundled ? { ok: true } : checkNode(process.version)),
        warn: (msg) => console.error(msg),
    };
    return runLaunch(argv, deps);
}
// Run only when invoked directly (node dist/cli/oss-launch.js …), not when imported.
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('oss-launch.js') ||
    process.argv[1]?.endsWith('oss-launch.cjs') ||
    process.argv[1]?.endsWith('oss-launch.ts') ||
    // Bundled self-contained binary: argv[1] is undefined and the entry IS process.execPath.
    (process.argv[1] === undefined && /oss-launch/.test(process.execPath));
if (isMainModule) {
    main(process.argv.slice(2))
        .then((code) => {
        // start-proxy dispatch returns undefined → do NOT exit (let the proxy server keep the
        // process alive in foreground; background runs end naturally).
        if (typeof code === 'number')
            process.exit(code);
    })
        .catch((err) => {
        console.error(`[oss-launch] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
//# sourceMappingURL=oss-launch.js.map