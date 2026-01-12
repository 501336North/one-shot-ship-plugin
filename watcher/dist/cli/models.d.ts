#!/usr/bin/env node
/**
 * /oss:models CLI Command
 *
 * Provides model management for per-prompt model routing.
 *
 * @behavior Model CLI provides list, search, config, set, test, and keys subcommands
 * @acceptance-criteria AC-MODELS.1 through AC-MODELS.7
 *
 * Usage:
 *   /oss:models list                    - Show available models grouped by provider
 *   /oss:models search <query>          - Filter models by name/capability
 *   /oss:models search --free           - Show only free models
 *   /oss:models config                  - Show current model configuration
 *   /oss:models set <prompt> <model>    - Configure model for a prompt
 *   /oss:models test <model>            - Verify model connectivity
 *   /oss:models keys set <provider> <key> - Store API key for provider
 *   /oss:models keys list               - List configured API keys (masked)
 */
/**
 * Set test mode for provider failure simulation
 */
export declare function setTestModeProviderFail(fail: boolean): void;
/**
 * Execute the models command with given arguments
 */
export declare function executeModelsCommand(args: string[]): Promise<string>;
//# sourceMappingURL=models.d.ts.map