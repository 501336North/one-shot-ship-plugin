---
description: Configure per-prompt model routing and view cost tracking
---

## Help

**Command:** `/oss:models`

**Description:** Configure per-prompt model routing and view cost tracking

**Workflow Position:** any time - **MODELS** configuration

**Usage:**
```bash
/oss:models [SUBCOMMAND] [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | list, set, costs (default: show configuration) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--provider` | | Filter by provider (ollama, openrouter, etc.) |
| `--reset` | | Reset cost tracking |

**Examples:**
```bash
# Show current model configuration
/oss:models

# List available models
/oss:models list

# List only Ollama models
/oss:models list --provider ollama

# Set model for an agent
/oss:models set oss:code-reviewer ollama/codellama

# Show session cost breakdown
/oss:models costs

# Reset cost tracking
/oss:models costs --reset
```

**Related Commands:**
- `/oss:status` - Check subscription status
- `/oss:settings` - Configure preferences
- `/oss:login` - Configure API key

---

# /oss:models - Per-Prompt Model Routing

Configure which AI models are used for specific commands, agents, and skills. Track usage costs across providers.

## Usage

```bash
/oss:models                                    # Show current model configuration
/oss:models list                               # List available models by provider
/oss:models list --provider ollama             # List only Ollama models
/oss:models set oss:code-reviewer ollama/codellama   # Set model for agent
/oss:models costs                              # Show session cost breakdown
/oss:models costs --reset                      # Reset cost tracking
```

## Implementation

When user runs `/oss:models`:

### Step 1: Load Current Configuration

Read model config from `~/.oss/config.json` and project `.oss/config.json`:

```bash
USER_CONFIG=~/.oss/config.json
PROJECT_CONFIG=.oss/config.json

# Load user config
if [[ -f "$USER_CONFIG" ]]; then
    USER_MODELS=$(jq '.models // {}' "$USER_CONFIG")
fi

# Load project config (takes precedence)
if [[ -f "$PROJECT_CONFIG" ]]; then
    PROJECT_MODELS=$(jq '.models // {}' "$PROJECT_CONFIG")
fi
```

### Step 2: Display Current Configuration

Show current model mappings in a formatted table:

```
Model Configuration
===================

Commands:
  /oss:ship         → default (Claude)
  /oss:review       → ollama/codellama

Agents:
  oss:code-reviewer → openrouter/deepseek/chat
  oss:test-engineer → default (Claude)

Skills:
  (none configured)

Hooks:
  (none configured)

Provider API Keys:
  openrouter: ✓ configured (OPENROUTER_API_KEY)
  ollama:     ✓ running (http://localhost:11434)
  openai:     ✗ not configured
  gemini:     ✗ not configured
```

### Step 3: Subcommand Handling

#### `/oss:models list`

List available models by provider:

```
Available Models
================

OpenRouter:
  openrouter/deepseek/deepseek-chat      DeepSeek Chat      $0.14/$0.28 per 1M
  openrouter/deepseek/deepseek-coder     DeepSeek Coder     $0.14/$0.28 per 1M
  openrouter/anthropic/claude-3.5-sonnet Claude 3.5 Sonnet  $3.00/$15.00 per 1M
  openrouter/meta-llama/llama-3.2-3b:free Llama 3.2 3B      FREE

Ollama (local):
  ollama/llama3.2          Llama 3.2        FREE (local)
  ollama/codellama         CodeLlama        FREE (local)
  ollama/mistral           Mistral          FREE (local)
  ollama/qwen2.5-coder     Qwen 2.5 Coder   FREE (local)

OpenAI:
  openai/gpt-4o            GPT-4o           $2.50/$10.00 per 1M
  openai/gpt-4o-mini       GPT-4o Mini      $0.15/$0.60 per 1M
  openai/o1                o1               $15.00/$60.00 per 1M

Gemini:
  gemini/gemini-2.0-flash  Gemini 2.0 Flash $0.075/$0.30 per 1M
  gemini/gemini-1.5-pro    Gemini 1.5 Pro   $1.25/$5.00 per 1M
```

#### `/oss:models set <prompt> <model>`

Set model for a specific prompt:

```bash
# Parse arguments
PROMPT_NAME="$1"   # e.g., "oss:code-reviewer" or "/oss:ship"
MODEL_ID="$2"      # e.g., "ollama/codellama"

# Determine prompt type
if [[ "$PROMPT_NAME" == /oss:* ]]; then
    TYPE="commands"
    NAME="${PROMPT_NAME#/}"
elif [[ "$PROMPT_NAME" == oss:* ]]; then
    TYPE="agents"
    NAME="$PROMPT_NAME"
else
    TYPE="skills"
    NAME="$PROMPT_NAME"
fi

# Update config
node "$PLUGIN_ROOT/watcher/dist/cli/models.js" set "$TYPE" "$NAME" "$MODEL_ID"
```

#### `/oss:models costs`

Display session cost breakdown:

```
Session Cost Breakdown
======================

Command          Model                    Tokens     Cost
─────────────────────────────────────────────────────────
/oss:ship        openrouter/deepseek      45,230    $0.02
/oss:plan        gemini/gemini-2.0-flash  12,450    $0.01
/oss:review      ollama/codellama         89,120    $0.00

─────────────────────────────────────────────────────────
Total                                     146,800   $0.03

Note: Ollama models are free (local). Cost only for API models.
```

### Step 4: Configuration Precedence

Model selection follows this precedence (highest to lowest):

1. **CLI Override**: `--model gemini/gemini-2.0-flash`
2. **User Settings**: `~/.oss/settings.json`
3. **Project Config**: `.oss/config.json`
4. **Frontmatter**: Model in prompt file frontmatter
5. **Default**: Claude (native execution)

### Step 5: Provider Setup

Use `AskUserQuestion` for provider API key setup:

```json
{
  "question": "Which provider would you like to configure?",
  "header": "Provider",
  "options": [
    {"label": "OpenRouter", "description": "Access 100+ models via single API"},
    {"label": "Ollama", "description": "Run models locally (free)"},
    {"label": "OpenAI", "description": "GPT-4o, o1, and more"},
    {"label": "Gemini", "description": "Google's Gemini models"}
  ],
  "multiSelect": false
}
```

For API key input:
- OpenRouter: Prompt for `OPENROUTER_API_KEY`
- OpenAI: Prompt for `OPENAI_API_KEY`
- Gemini: Prompt for `GEMINI_API_KEY`
- Ollama: Verify server is running at `http://localhost:11434`

## Configuration Schema

### ~/.oss/config.json

```json
{
  "models": {
    "default": "claude",
    "agents": {
      "oss:code-reviewer": "openrouter/deepseek/deepseek-chat",
      "oss:test-engineer": "ollama/codellama"
    },
    "commands": {
      "oss:ship": "gemini/gemini-2.0-flash"
    },
    "skills": {},
    "hooks": {}
  },
  "apiKeys": {
    "openrouter": "sk-or-xxx",
    "openai": "sk-xxx",
    "gemini": "xxx"
  }
}
```

### .oss/config.json (project-level)

```json
{
  "models": {
    "default": "ollama/llama3.2",
    "agents": {
      "oss:code-reviewer": "ollama/qwen2.5-coder"
    }
  }
}
```

## Frontmatter Configuration

Prompts can specify preferred models in frontmatter:

```yaml
---
name: code-reviewer
model: openrouter/deepseek/deepseek-chat
model_fallback: true
---
# Code Reviewer Prompt
```

- `model`: Preferred model for this prompt
- `model_fallback`: If true, fall back to Claude if model fails

## Environment Variables

API keys can be set via environment variables (takes precedence over config):

| Provider | Environment Variable |
|----------|---------------------|
| OpenRouter | `OPENROUTER_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` |

Ollama doesn't require an API key (local).

## Supported Providers

### OpenRouter
Access 100+ models through a single API. Requires API key from https://openrouter.ai

Recommended models:
- `openrouter/deepseek/deepseek-chat` - Fast, cheap, good for coding
- `openrouter/anthropic/claude-3.5-sonnet` - Claude via OpenRouter
- `openrouter/meta-llama/llama-3.2-3b:free` - Free tier

### Ollama
Run models locally. Requires Ollama installed: https://ollama.ai

Recommended models:
- `ollama/llama3.2` - General purpose
- `ollama/codellama` - Code-focused
- `ollama/qwen2.5-coder` - Excellent for code

### OpenAI
GPT models. Requires API key from https://platform.openai.com

Recommended models:
- `openai/gpt-4o` - Best overall
- `openai/gpt-4o-mini` - Fast and cheap
- `openai/o1` - Reasoning tasks

### Gemini
Google's Gemini models. Requires API key from https://ai.google.dev

Recommended models:
- `gemini/gemini-2.0-flash` - Fast and cheap
- `gemini/gemini-1.5-pro` - More capable

## Fallback Behavior

When a configured model fails:
1. User is notified via status line
2. Request falls back to Claude (native)
3. Cost tracking continues with actual model used

To disable fallback for a prompt, set `model_fallback: false` in frontmatter.

## Cost Tracking

Costs are tracked per-command at these price points (per 1M tokens):

| Model | Input | Output |
|-------|-------|--------|
| openrouter/deepseek/* | $0.14 | $0.28 |
| openrouter/anthropic/claude-3.5-sonnet | $3.00 | $15.00 |
| openai/gpt-4o | $2.50 | $10.00 |
| openai/gpt-4o-mini | $0.15 | $0.60 |
| gemini/gemini-2.0-flash | $0.075 | $0.30 |
| ollama/* | FREE | FREE |
| default (Claude) | N/A | N/A (via Claude Code subscription) |
