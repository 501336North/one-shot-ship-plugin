# Model Configuration Examples

Example configurations for per-prompt model routing in OSS Dev Workflow.

## Available Presets

| Preset | Use Case | Providers Used |
|--------|----------|----------------|
| `cost-optimized.json` | Minimize costs | Ollama (free), OpenRouter free tier |
| `quality-focused.json` | Maximum quality | OpenAI (o1, GPT-4o), Claude |
| `balanced.json` | Quality + cost balance | All providers |
| `privacy-first.json` | Data stays local | Ollama + Claude only |

## How to Use

### Option 1: Copy to User Config

```bash
# Copy a preset to your user config
cp cost-optimized.json ~/.oss/config.json

# Or merge with existing config
jq -s '.[0] * .[1]' ~/.oss/config.json cost-optimized.json > ~/.oss/config.new.json
mv ~/.oss/config.new.json ~/.oss/config.json
```

### Option 2: Copy to Project Config

```bash
# Use for a specific project
cp balanced.json /path/to/project/.oss/config.json
```

### Option 3: Use /oss:models CLI

```bash
# Set individual model mappings
/oss:models set oss:code-reviewer ollama/codellama
/oss:models set /oss:ship gemini/gemini-2.0-flash
```

## Provider Setup

### Ollama (Local, Free)

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull recommended models
ollama pull llama3.2
ollama pull codellama
ollama pull qwen2.5-coder
ollama pull mistral
```

### OpenRouter

1. Get API key from https://openrouter.ai
2. Set environment variable: `export OPENROUTER_API_KEY=sk-or-xxx`
3. Or add to config: `"apiKeys": { "openrouter": "sk-or-xxx" }`

### OpenAI

1. Get API key from https://platform.openai.com
2. Set environment variable: `export OPENAI_API_KEY=sk-xxx`
3. Or add to config: `"apiKeys": { "openai": "sk-xxx" }`

### Gemini

1. Get API key from https://ai.google.dev
2. Set environment variable: `export GEMINI_API_KEY=xxx`
3. Or add to config: `"apiKeys": { "gemini": "xxx" }`

## Configuration Precedence

Model selection follows this order (highest priority first):

1. **CLI Override**: `/oss:build --model gemini/gemini-2.0-flash`
2. **User Settings**: `~/.oss/settings.json`
3. **Project Config**: `.oss/config.json`
4. **Frontmatter**: Model specified in prompt file
5. **Default**: Claude (native execution)

## Creating Custom Configs

```json
{
  "models": {
    "default": "claude",
    "agents": {
      "oss:code-reviewer": "your-preferred-model"
    },
    "commands": {
      "oss:ship": "your-preferred-model"
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

## Cost Comparison

Approximate costs per 1M tokens (input/output):

| Model | Input | Output | Best For |
|-------|-------|--------|----------|
| ollama/* | FREE | FREE | All local tasks |
| openrouter/deepseek/* | $0.14 | $0.28 | Code review, general |
| openrouter/llama-3.2-3b:free | FREE | FREE | Simple tasks |
| gemini/gemini-2.0-flash | $0.075 | $0.30 | Fast, cheap |
| openai/gpt-4o-mini | $0.15 | $0.60 | Balanced |
| openai/gpt-4o | $2.50 | $10.00 | Quality |
| openai/o1 | $15.00 | $60.00 | Complex reasoning |
| claude (native) | N/A | N/A | Via subscription |
