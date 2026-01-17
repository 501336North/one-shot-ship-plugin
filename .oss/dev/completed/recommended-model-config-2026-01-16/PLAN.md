# Plan: Recommended Model Routing Configuration

## Overview

Deploy comprehensive model routing configuration based on analysis of 152 prompts (55 commands, 41 agents, 56 skills).

**Goal**: Maintain high quality while minimizing Claude Max 5x token usage for tasks where cheaper models perform equally well.

## Pre-Requisites

The model routing infrastructure is **COMPLETE** (247 tests, 10 phases). This task is configuration-only.

## Phase 1: Create Recommended Configuration File

### Task 1.1: Create comprehensive model config
- **Location**: `examples/model-configs/recommended.json`
- **Content**: Full mapping for all commands and agents based on our analysis

**Model Assignment Strategy**:

| Category | Model | Rationale |
|----------|-------|-----------|
| Complex reasoning | `claude` | Planning, architecture, incident response |
| Code generation | `openrouter/deepseek/deepseek-chat` | Excellent at code, 95% cheaper |
| Docs/analysis | `gemini/gemini-2.0-flash` | Fast, cheap, structured output |
| Simple utilities | `ollama/llama3.2` | Free, local |
| Code-focused local | `ollama/qwen2.5-coder` | Free, code-optimized |

### Task 1.2: Add provider configuration section
- **Ollama URL**: Configurable via `providers.ollama.baseUrl`
- **API Keys**: Documented placeholders for OpenRouter, Gemini, OpenAI

## Phase 2: Update Settings Schema

### Task 2.1: Add providers section to ModelSettings type
- **File**: `watcher/src/types/model-settings.ts`
- **Change**: Add `providers` interface for base URLs

```typescript
interface ProviderSettings {
  ollama?: {
    baseUrl?: string; // default: http://localhost:11434
  };
}
```

### Task 2.2: Wire Ollama baseUrl to handler
- **File**: `watcher/src/services/model-executor.ts` or proxy initialization
- **Behavior**: Read `providers.ollama.baseUrl` from config and pass to OllamaHandler

## Phase 3: Create Deployment Script

### Task 3.1: Create oss-models-init CLI
- **File**: `watcher/src/cli/models-init.ts`
- **Purpose**: Initialize `~/.oss/config.json` with recommended config
- **Features**:
  - Copy recommended config to user directory
  - Prompt for API keys (or leave placeholders)
  - Validate Ollama is accessible

### Task 3.2: Add /oss:models init subcommand
- **File**: `commands/models.md`
- **Usage**: `/oss:models init` or `/oss:models init --config=recommended`

## Phase 4: Documentation

### Task 4.1: Update commands/models.md
- Add example of recommended config
- Document provider configuration (baseUrl, apiKeys)
- Add troubleshooting for common issues

### Task 4.2: Create setup guide
- Step-by-step: Get OpenRouter API key
- Step-by-step: Configure Gemini API key
- Step-by-step: Ensure Ollama is running

## Phase 5: Auto-Clear with Pre-hooks (Deferred Task 1.7)

Implement automatic context clearing before major workflow commands.

### Task 5.1: Add auto-clear to oss-precommand.sh
- **File**: `hooks/oss-precommand.sh`
- **Behavior**: For ideate, plan, build, ship commands, trigger `/clear` before execution
- **Implementation**: Use Claude Code's clear mechanism or equivalent

### Task 5.2: Remove oss-context-gate.sh (now redundant)
- **File**: `hooks/oss-context-gate.sh` → DELETE
- **File**: `.claude-plugin/hooks.json` → Remove context-gate entry
- **Rationale**: Auto-clear makes manual context gate unnecessary

### Task 5.3: Add tests for auto-clear behavior
- **File**: `watcher/test/hooks/auto-clear.test.ts`
- **Tests**:
  - Verify clear is triggered for major commands
  - Verify clear is NOT triggered for minor commands (red, green, refactor)
  - Verify --no-clear flag bypasses auto-clear

## Phase 6: Extended Thinking Cleanup (Deferred Task 1.3)

Audit and clean up extended thinking patterns in command files.

### Task 6.1: Audit all command files for thinking patterns
- **Scope**: All files in `commands/*.md`
- **Look for**: Inconsistent or outdated thinking block patterns
- **Document**: List of files needing cleanup

### Task 6.2: Standardize thinking pattern usage
- **Pattern**: Define consistent extended thinking format
- **Apply**: Update all command files to use standard pattern
- **Test**: Verify commands still work correctly after cleanup

## Acceptance Criteria

1. User can run `/oss:models init` to deploy recommended configuration
2. Fallback to Claude works when providers unavailable
3. Ollama baseUrl is configurable (not hardcoded localhost:11434)
4. All 152 prompts have appropriate model assignments
5. Cost savings estimated at 70-80% for routine operations

## Configuration Preview

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    }
  },
  "apiKeys": {
    "openrouter": "${OPENROUTER_API_KEY}",
    "gemini": "${GEMINI_API_KEY}"
  },
  "models": {
    "default": "claude",
    "fallbackEnabled": true,

    "commands": {
      "oss:red": "openrouter/deepseek/deepseek-chat",
      "oss:green": "openrouter/deepseek/deepseek-chat",
      "oss:refactor": "openrouter/deepseek/deepseek-chat",
      "oss:review": "openrouter/deepseek/deepseek-chat",
      "oss:mock": "openrouter/deepseek/deepseek-chat",
      "oss:acceptance": "openrouter/deepseek/deepseek-chat",
      "oss:integration": "openrouter/deepseek/deepseek-chat",
      "oss:contract": "openrouter/deepseek/deepseek-chat",
      "oss:bench": "openrouter/deepseek/deepseek-chat",

      "oss:requirements": "gemini/gemini-2.0-flash",
      "oss:data-model": "gemini/gemini-2.0-flash",
      "oss:adr": "gemini/gemini-2.0-flash",
      "oss:release": "gemini/gemini-2.0-flash",
      "oss:stage": "gemini/gemini-2.0-flash",
      "oss:rollback": "gemini/gemini-2.0-flash",
      "oss:monitor": "gemini/gemini-2.0-flash",
      "oss:audit": "gemini/gemini-2.0-flash",
      "oss:a11y": "gemini/gemini-2.0-flash",
      "oss:cost": "gemini/gemini-2.0-flash",
      "oss:docs": "gemini/gemini-2.0-flash",
      "oss:test": "gemini/gemini-2.0-flash",

      "oss:smoke": "ollama/qwen2.5-coder:7b",
      "oss:load": "ollama/qwen2.5-coder:7b",
      "oss:trace": "ollama/qwen2.5-coder:7b",

      "oss:status": "ollama/llama3.2",
      "oss:queue": "ollama/llama3.2",
      "oss:legend": "ollama/llama3.2",
      "oss:settings": "ollama/llama3.2",
      "oss:models": "ollama/llama3.2"
    },

    "agents": {
      "oss:typescript-pro": "openrouter/deepseek/deepseek-chat",
      "oss:nextjs-developer": "openrouter/deepseek/deepseek-chat",
      "oss:react-specialist": "openrouter/deepseek/deepseek-chat",
      "oss:frontend-developer": "openrouter/deepseek/deepseek-chat",
      "oss:golang-pro": "openrouter/deepseek/deepseek-chat",
      "oss:python-pro": "openrouter/deepseek/deepseek-chat",
      "oss:java-pro": "openrouter/deepseek/deepseek-chat",
      "oss:ios-developer": "openrouter/deepseek/deepseek-chat",
      "oss:swift-macos-expert": "openrouter/deepseek/deepseek-chat",
      "oss:flutter-expert": "openrouter/deepseek/deepseek-chat",
      "oss:visionos-developer": "openrouter/deepseek/deepseek-chat",
      "oss:mobile-developer": "openrouter/deepseek/deepseek-chat",
      "oss:graphql-architect": "openrouter/deepseek/deepseek-chat",
      "oss:test-engineer": "openrouter/deepseek/deepseek-chat",
      "oss:code-reviewer": "openrouter/deepseek/deepseek-chat",
      "oss:debugger": "openrouter/deepseek/deepseek-chat",
      "oss:refactoring-specialist": "openrouter/deepseek/deepseek-chat",
      "oss:performance-engineer": "openrouter/deepseek/deepseek-chat",
      "oss:database-optimizer": "openrouter/deepseek/deepseek-chat",

      "oss:qa-expert": "gemini/gemini-2.0-flash",
      "oss:docs-architect": "gemini/gemini-2.0-flash",
      "oss:security-auditor": "gemini/gemini-2.0-flash",
      "oss:seo-aeo-expert": "gemini/gemini-2.0-flash",
      "oss:test-automator": "gemini/gemini-2.0-flash",
      "oss:dependency-analyzer": "gemini/gemini-2.0-flash",
      "oss:data-engineer": "gemini/gemini-2.0-flash",
      "oss:performance-auditor": "gemini/gemini-2.0-flash",
      "oss:database-admin": "gemini/gemini-2.0-flash",
      "oss:release-manager": "gemini/gemini-2.0-flash",
      "oss:n8n-automation-specialist": "gemini/gemini-2.0-flash",

      "oss:deployment-engineer": "ollama/qwen2.5-coder:7b",
      "oss:devops-troubleshooter": "ollama/qwen2.5-coder:7b",
      "oss:git-workflow-manager": "ollama/llama3.2"
    }
  }
}
```

## Test Strategy

1. **Unit tests**: Already complete (247 tests for model routing)
2. **Integration test**: Verify fallback works when OpenRouter key missing
3. **Manual test**: Run `/oss:models` and verify config loads correctly

## Estimated Effort

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 1 | 2 | Simple (config file only) |
| Phase 2 | 2 | Moderate (type changes + wiring) |
| Phase 3 | 2 | Moderate (CLI command) |
| Phase 4 | 2 | Simple (documentation) |
| Phase 5 | 3 | Moderate (hook changes + remove dead code) |
| Phase 6 | 2 | Simple (audit + cleanup) |

**Total**: 13 tasks across 6 phases.

## Last Updated: 2026-01-13 by /oss:plan
