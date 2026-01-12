#!/usr/bin/env node
/**
 * Agent Model Check CLI
 *
 * Called by agent prompts to determine if custom model routing is configured.
 *
 * @behavior Checks if a custom model is configured for an agent
 * @acceptance-criteria AC-AMC.1 through AC-AMC.7
 *
 * Usage:
 *   node agent-model-check.js --agent <agent-name>
 *   node agent-model-check.js --agent <agent-name> --task "task description"
 *   node agent-model-check.js --agent <agent-name> --project "/path/to/project"
 *
 * Output (JSON):
 *   { "useProxy": false } - Use native Claude
 *   { "useProxy": true, "model": "ollama/codellama", "provider": "ollama", "proxyUrl": "http://localhost:3456" }
 */
/**
 * Result from checking agent model configuration
 */
export interface CheckResult {
    useProxy: boolean;
    model?: string;
    provider?: string;
    proxyUrl?: string;
}
/**
 * Parameters for checking agent model
 */
export interface CheckAgentModelParams {
    agentName: string;
    projectDir: string;
    task?: string;
}
/**
 * Parsed CLI arguments
 */
export interface ParsedArgs {
    agentName: string;
    task?: string;
    projectDir: string;
}
/**
 * Check if custom model is configured for an agent
 */
export declare function checkAgentModel(params: CheckAgentModelParams): Promise<CheckResult>;
/**
 * Parse CLI arguments
 */
export declare function parseCliArgs(args: string[]): ParsedArgs;
/**
 * Format output as JSON string
 */
export declare function formatOutput(result: CheckResult): string;
//# sourceMappingURL=agent-model-check.d.ts.map