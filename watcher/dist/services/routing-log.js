/**
 * routing-log — loud, always-on per-request route log for the model proxy.
 *
 * Distinct from the opt-in OSS_PROXY_LOG: this ALWAYS records where each agent's request went
 * (and any fallback), so a silent degrade to cloud can never again masquerade as success.
 * Best-effort: any I/O failure is swallowed so logging never breaks a request.
 */
import * as fs from 'fs';
import * as path from 'path';
export function createRoutingLogger(logPath) {
    return (entry) => {
        try {
            const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.appendFileSync(logPath, line);
        }
        catch {
            /* observability must never break the proxy */
        }
    };
}
//# sourceMappingURL=routing-log.js.map