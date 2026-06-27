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
/**
 * Launch claude, routing through the proxy only when models.agents is configured.
 * Resolves to the child's exit code.
 */
export async function runLaunch(argv, deps) {
    const decision = resolveLaunch(deps.loadConfig(), deps.baseEnv);
    if (decision.useProxy && decision.port !== undefined) {
        await deps.ensureProxy(decision.port);
    }
    const bin = deps.resolveClaudeBin();
    const child = deps.spawn(bin, argv, { env: decision.env, stdio: 'inherit' });
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
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const http = await import('http');
    const { spawn } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const selfPath = (() => {
        try {
            return fs.realpathSync(process.argv[1] ?? fileURLToPath(import.meta.url));
        }
        catch {
            return process.argv[1] ?? '';
        }
    })();
    const startProxyJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'start-proxy.js');
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
                const child = spawn(process.execPath, [startProxyJs, '--router', '--background', '--port', String(port)], { detached: true, stdio: 'ignore' });
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
    };
    return runLaunch(argv, deps);
}
// Run only when invoked directly (node dist/cli/oss-launch.js …), not when imported.
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('oss-launch.js') ||
    process.argv[1]?.endsWith('oss-launch.ts');
if (isMainModule) {
    main(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((err) => {
        console.error(`[oss-launch] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
//# sourceMappingURL=oss-launch.js.map