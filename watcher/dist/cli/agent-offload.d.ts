/**
 * agent-offload - Run a routable interactive agent's work on its configured local model
 * (e.g. gpt-oss@deepblue) by spawning a nested "mini-claudish" Claude session pointed at the
 * :3456 ModelProxy via ANTHROPIC_BASE_URL.
 *
 * This is the function each routable agent's `## Step 0.5` invokes. It is the ONLY place the
 * interactive client actually offloads inference to a local model — without it, agents merely
 * print a banner and keep reasoning on Claude.
 *
 * Design: DESIGN.md / PLAN.md in
 *   one-shot-ship-plugin/.oss/dev/active/interactive-local-model-offload/
 *
 * Behaviour contract (acceptance test:
 *   watcher/test/acceptance/interactive-local-model-offload.acceptance.test.ts):
 *   - Mapped agent (useProxy:true) + proxy reachable + nested session succeeds → offloaded:true
 *   - No mapping (useProxy:false) → offloaded:false, nothing spawned (default-OFF for customers)
 *   - Nested failure / proxy down → offloaded:false, fallback:true (native Claude takes over)
 *   - NEVER throws into the calling agent — a broken local route must never break the agent.
 *
 * Usage (CLI):
 *   node agent-offload.js --agent oss:code-reviewer --prompt-file /tmp/prompt.txt
 * Output (JSON): OffloadResult
 */
import * as childProcess from 'child_process';
import { CheckResult } from './agent-model-check.js';
export interface OffloadParams {
    /** Agent id, e.g. "oss:code-reviewer". */
    agent: string;
    /** Path to the assembled prompt (expert prompt + task context) fed to the nested session. */
    promptFile: string;
    /** Project dir for config precedence. Defaults to cwd. */
    projectDir?: string;
    /** Safety net (default true): on any offload failure, degrade to native Claude. */
    fallbackEnabled?: boolean;
}
export type OffloadReason = 'native' | 'proxy_down' | 'spawn_error' | 'empty_output';
export interface OffloadResult {
    /** True only when the local model actually produced the work. */
    offloaded: boolean;
    /** The local model's output (when offloaded). */
    output?: string;
    /** True when we degraded to native Claude instead of offloading. */
    fallback?: boolean;
    /** Why we did not offload. */
    reason?: OffloadReason;
    /** Error detail (failures only). */
    error?: string;
}
/** Injectable collaborators (London TDD — mirrors the repo's `_testSpawn` idiom). */
export interface OffloadDeps {
    checkAgentModel?: (p: {
        agentName: string;
        projectDir: string;
    }) => Promise<CheckResult>;
    isProxyReachable?: (url: string) => Promise<boolean>;
    spawnFn?: typeof childProcess.spawn;
    readPrompt?: (file: string) => string;
    startProxy?: (opts: {
        model: string;
        port: number;
    }) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Pure: build the nested-session invocation. The base URL is what diverts inference to the
 * local model; OSS_OFFLOAD_ACTIVE=1 is the depth-1 recursion guard (see agent-model-check).
 */
export declare function buildOffloadInvocation(routing: CheckResult): {
    cmd: string;
    args: string[];
    env: NodeJS.ProcessEnv;
};
/** Pure: classify a finished nested run. */
export declare function classifyResult(exitCode: number, stdout: string): 'success' | 'empty_output' | 'spawn_error';
/**
 * Run the agent's work on its configured local model via a nested mini-claudish session.
 * Resolves (never rejects) — any failure degrades to a native-Claude signal.
 */
export declare function runAgentOffload(params: OffloadParams, deps?: OffloadDeps): Promise<OffloadResult>;
export declare function parseOffloadArgs(argv: string[]): OffloadParams;
//# sourceMappingURL=agent-offload.d.ts.map