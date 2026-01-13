# Per-Prompt Model Routing - Design Document

**Feature**: OSS-native model routing system for per-prompt model selection
**Status**: Design Complete
**Created**: 2024-01-12
**Inspired By**: [Claudish](https://github.com/MadAppGang/claudish)

---

## Overview

Enable users to configure different AI models for each OSS prompt (agents, commands, skills, hooks) with automatic fallback to Claude Code's native model.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     OSS Model Routing System                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐         ┌──────────────┐                        │
│  │ /oss:ship       │         │              │                        │
│  │ model: default  │────────▶│              │──▶ Claude (native)     │
│  └─────────────────┘         │              │                        │
│                              │  OSS Model   │                        │
│  ┌─────────────────┐         │   Router     │    ┌────────────────┐  │
│  │ code-reviewer   │────────▶│              │───▶│  Model Proxy   │  │
│  │ model: deepseek │         │ - Config     │    │  (on-demand)   │  │
│  └─────────────────┘         │ - Precedence │    │                │  │
│                              │ - Fallback   │    │ ┌────────────┐ │  │
│  ┌─────────────────┐         │              │    │ │ OpenRouter │ │  │
│  │ oss:red         │────────▶│              │───▶│ │ Ollama     │ │  │
│  │ model: ollama   │         │              │    │ │ OpenAI     │ │  │
│  └─────────────────┘         └──────────────┘    │ │ Gemini     │ │  │
│                                     │            │ └────────────┘ │  │
│                                     ▼            └────────────────┘  │
│                              ┌────────────┐                          │
│                              │  Fallback  │                          │
│                              │ to Claude  │                          │
│                              │ on failure │                          │
│                              └────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

### D1: Supported Providers

| Provider | Priority | Integration |
|----------|----------|-------------|
| **OpenRouter** | v1.0 | 100+ models via single API |
| **Ollama** | v1.0 | Local models, free, offline |
| **OpenAI Direct** | v1.0 | GPT-4o, o1, o3 |
| **Google Gemini** | v1.0 | Gemini 2.0 Flash/Pro |

### D2: Configuration Precedence (Highest to Lowest)

```
1. CLI flag:        /oss:ship --model gemini/gemini-2.0-flash
2. User settings:   ~/.oss/config.json → models.commands["oss:ship"]
3. Project config:  .oss/config.json → models.commands["oss:ship"]
4. Frontmatter:     commands/ship.md → model: "..."
5. Default:         Claude Code native model
```

### D3: Proxy Lifecycle

**On-demand per-invocation** (matches Claudish):
1. Command invoked with non-Claude model
2. Start proxy server on available port
3. Execute command through proxy
4. Shutdown proxy immediately after

Benefits:
- No lingering processes
- No port conflicts
- Clean resource management

### D4: Fallback Behavior

**Notify and fallback** (Option B):
```
[oss] Model 'deepseek/deepseek-chat' failed: connection timeout
[oss] Falling back to Claude...
```

- Transparent to user
- Non-blocking (no confirmation needed)
- Logged for debugging

### D5: Cost Tracking

**Per-command granularity**:
```json
{
  "costs": {
    "2024-01-12": {
      "oss:ship": { "tokens": 45000, "cost_usd": 0.12 },
      "oss:code-reviewer": { "tokens": 120000, "cost_usd": 0.08 },
      "oss:plan": { "tokens": 30000, "cost_usd": 0.15 }
    }
  }
}
```

### D6: API Key Storage

**Primary**: `~/.oss/config.json`
**Override**: Environment variables

```json
// ~/.oss/config.json
{
  "apiKeys": {
    "openrouter": "sk-or-...",
    "openai": "sk-...",
    "gemini": "AIza..."
  }
}
```

```bash
# Environment overrides
export OPENROUTER_API_KEY="sk-or-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="AIza..."
```

---

## Configuration Schema

### Hybrid Configuration Approach

#### 1. Frontmatter in Prompt Files (Preferred Model)

```markdown
---
name: code-reviewer
description: Expert code reviewer
model: openrouter/deepseek/deepseek-chat
model_fallback: true
---

# Code Reviewer Agent
...
```

#### 2. Centralized Settings (~/.oss/config.json)

```json
{
  "models": {
    "default": "claude",
    "fallback_enabled": true,

    "agents": {
      "oss:code-reviewer": "openrouter/deepseek/deepseek-chat",
      "oss:security-auditor": "anthropic/claude-3-opus",
      "oss:performance-auditor": "gemini/gemini-2.0-flash",
      "oss:typescript-pro": "openai/gpt-4o",
      "oss:debugger": "ollama/codellama"
    },

    "commands": {
      "oss:ship": "default",
      "oss:plan": "default",
      "oss:ideate": "gemini/gemini-2.0-flash-thinking",
      "oss:review": "openrouter/anthropic/claude-3.5-sonnet"
    },

    "skills": {
      "oss:red": "default",
      "oss:green": "ollama/deepseek-coder",
      "oss:refactor": "openrouter/anthropic/claude-3.5-sonnet"
    },

    "hooks": {
      "pre-commit": "ollama/llama3.2",
      "iron-law-check": "gemini/gemini-2.0-flash"
    }
  },

  "apiKeys": {
    "openrouter": "sk-or-v1-xxx",
    "openai": "sk-xxx",
    "gemini": "AIzaxxx"
  }
}
```

#### 3. Project-Level Override (.oss/config.json)

Same schema as user settings, but scoped to project.

#### 4. CLI Override

```bash
# One-off model override
/oss:ship --model gemini/gemini-2.0-flash

# Use local model for this command
/oss:review --model ollama/codellama
```

---

## Model Identifier Format

```
<provider>/<model-id>

# Examples:
openrouter/deepseek/deepseek-chat
openrouter/anthropic/claude-3.5-sonnet
openai/gpt-4o
openai/o1
gemini/gemini-2.0-flash
gemini/gemini-2.0-pro
ollama/codellama
ollama/llama3.2
ollama/deepseek-coder

# Special values:
default     → Use Claude Code native
claude      → Same as default
```

---

## New Commands

### /oss:models

```bash
# List all available models
/oss:models

# Search models by capability
/oss:models search "code"
/oss:models search "fast"
/oss:models search "free"

# Show current configuration
/oss:models config

# Set model for a prompt
/oss:models set oss:code-reviewer openrouter/deepseek/deepseek-chat
/oss:models set oss:ship default

# Test model connectivity
/oss:models test gemini/gemini-2.0-flash

# Show cost summary
/oss:models costs
/oss:models costs --detailed
/oss:models costs --reset

# Configure API keys
/oss:models keys
/oss:models keys set openrouter sk-or-v1-xxx
```

---

## Architecture Components

### New Files

| File | Purpose |
|------|---------|
| `watcher/src/services/model-router.ts` | Config loading, model selection, precedence |
| `watcher/src/services/model-proxy.ts` | HTTP proxy server (ported from Claudish) |
| `watcher/src/services/api-transformer.ts` | Anthropic ↔ OpenAI/Gemini translation |
| `watcher/src/services/cost-tracker.ts` | Token counting, cost calculation |
| `watcher/src/services/model-registry.ts` | Available models, pricing, capabilities |
| `watcher/src/config/model-config.ts` | Config schema, validation |
| `watcher/src/cli/models.ts` | /oss:models command implementation |
| `commands/models.md` | /oss:models command prompt |

### Modified Files

| File | Changes |
|------|---------|
| `watcher/src/services/settings.ts` | Add model settings schema |
| `watcher/src/types/settings.ts` | Add ModelSettings interface |
| `hooks/oss-session-start.sh` | Initialize model router |

---

## API Translation

### Anthropic → OpenAI

```typescript
// Request transformation
{
  model: "claude-3-opus",
  messages: [...],
  max_tokens: 4096
}
↓
{
  model: "gpt-4o",
  messages: [...],  // Role mapping: system → system, etc.
  max_tokens: 4096,
  // Drop: anthropic-specific params
}

// Response transformation
{
  choices: [{ message: { content: "..." } }],
  usage: { prompt_tokens: 100, completion_tokens: 200 }
}
↓
{
  content: [{ type: "text", text: "..." }],
  usage: { input_tokens: 100, output_tokens: 200 }
}
```

### Tool/Function Call Translation

```typescript
// Anthropic tool_use → OpenAI function_call
// OpenAI tool_calls → Anthropic tool_use
// Handle streaming SSE translation
```

---

## Recommended Model Presets

```json
{
  "presets": {
    "cost-optimized": {
      "description": "Minimize API costs",
      "agents": {
        "*": "openrouter/deepseek/deepseek-chat"
      },
      "commands": {
        "oss:ideate": "gemini/gemini-2.0-flash",
        "*": "openrouter/deepseek/deepseek-chat"
      }
    },

    "quality-first": {
      "description": "Best quality, higher cost",
      "agents": {
        "oss:security-auditor": "anthropic/claude-3-opus",
        "oss:code-reviewer": "anthropic/claude-3-opus",
        "*": "openrouter/anthropic/claude-3.5-sonnet"
      }
    },

    "local-dev": {
      "description": "All local, zero cost",
      "agents": { "*": "ollama/codellama" },
      "commands": { "*": "ollama/llama3.2" },
      "skills": { "*": "ollama/deepseek-coder" }
    },

    "hybrid": {
      "description": "Balance of cost and quality",
      "agents": {
        "oss:security-auditor": "anthropic/claude-3-opus",
        "*": "openrouter/deepseek/deepseek-chat"
      },
      "commands": {
        "oss:ship": "default",
        "*": "gemini/gemini-2.0-flash"
      }
    }
  }
}
```

---

## Error Handling

### Model Failure → Fallback

```typescript
async function executeWithModel(prompt: Prompt, model: string): Promise<Result> {
  if (model === 'default' || model === 'claude') {
    return await nativeExecute(prompt);
  }

  try {
    const proxy = await startProxy(model);
    try {
      return await proxyExecute(prompt, proxy.url);
    } finally {
      await proxy.shutdown();
    }
  } catch (error) {
    if (prompt.fallbackEnabled !== false) {
      console.log(`[oss] Model '${model}' failed: ${error.message}`);
      console.log(`[oss] Falling back to Claude...`);
      return await nativeExecute(prompt);
    }
    throw error;
  }
}
```

### API Key Missing

```
[oss] Error: OpenRouter API key not configured
[oss] Run: /oss:models keys set openrouter <your-key>
[oss] Or set: export OPENROUTER_API_KEY=<your-key>
```

### Model Not Found

```
[oss] Error: Model 'openrouter/invalid-model' not found
[oss] Search available models: /oss:models search
```

---

## Security Considerations

1. **API keys stored in user config** - Not in project config (avoid commits)
2. **Env vars take precedence** - CI/CD can override without file changes
3. **No keys in frontmatter** - Model ID only, keys from config
4. **Proxy binds to localhost only** - No external access

---

## Testing Strategy

| Test Type | Coverage |
|-----------|----------|
| Unit tests | ModelRouter, ApiTransformer, CostTracker |
| Integration tests | Proxy ↔ Provider communication |
| E2E tests | Full command execution with model routing |
| Mock tests | Provider responses for offline testing |

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Port Claudish proxy server
- [ ] Implement API transformer (Anthropic ↔ OpenAI)
- [ ] ModelRouter with config loading
- [ ] Basic /oss:models command

### Phase 2: Provider Integration (Week 1-2)
- [ ] OpenRouter handler
- [ ] Ollama handler
- [ ] OpenAI direct handler
- [ ] Gemini handler

### Phase 3: Configuration & UX (Week 2)
- [ ] Frontmatter parsing in prompts
- [ ] Settings integration
- [ ] CLI override support
- [ ] Fallback logic

### Phase 4: Cost Tracking & Polish (Week 2-3)
- [ ] Token counting per provider
- [ ] Cost calculation and storage
- [ ] /oss:models costs command
- [ ] Model recommendations/presets

### Phase 5: Testing & Documentation (Week 3)
- [ ] Comprehensive test suite
- [ ] Documentation
- [ ] Example configurations

---

## Success Metrics

1. **Adoption**: % of users configuring custom models
2. **Cost savings**: Average cost reduction vs Claude-only
3. **Reliability**: Fallback trigger rate < 5%
4. **Performance**: Proxy overhead < 100ms

---

## Future Enhancements (v2+)

- [ ] A/B testing between models
- [ ] Automatic model selection based on task complexity
- [ ] Model performance benchmarking
- [ ] Team-wide model policies
- [ ] Usage quotas and alerts

---

*Design approved: Ready for /oss:plan*
