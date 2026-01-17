# Per-Prompt Model Routing - TDD Implementation Plan

**Feature**: Per-prompt model routing with hybrid configuration
**Method**: London TDD (Outside-In)
**Estimated Duration**: 3 weeks
**Created**: 2024-01-12

---

## TDD Approach

Every task follows **RED → GREEN → REFACTOR**:
1. **RED**: Write failing test first (design interface through mocks)
2. **GREEN**: Write minimal code to pass
3. **REFACTOR**: Clean up while tests stay green

---

## Phase 1: Core Types & Configuration (Days 1-2)

### Task 1.1: Model Settings Types
**File**: `watcher/src/types/model-settings.ts`

```typescript
// Test first: types/model-settings.test.ts
describe('ModelSettings Types', () => {
  it('should validate model identifier format', () => {
    expect(isValidModelId('openrouter/deepseek/deepseek-chat')).toBe(true);
    expect(isValidModelId('ollama/codellama')).toBe(true);
    expect(isValidModelId('default')).toBe(true);
    expect(isValidModelId('invalid')).toBe(false);
  });

  it('should parse provider from model identifier', () => {
    expect(parseProvider('openrouter/deepseek/chat')).toBe('openrouter');
    expect(parseProvider('ollama/codellama')).toBe('ollama');
    expect(parseProvider('default')).toBe('claude');
  });
});
```

**Acceptance Criteria**:
- [ ] `ModelSettings` interface defined
- [ ] `ModelIdentifier` type with validation
- [ ] `ProviderConfig` interface for API keys
- [ ] Provider parsing from model ID

---

### Task 1.2: Model Config Schema
**File**: `watcher/src/config/model-config.ts`

```typescript
// Test first: config/model-config.test.ts
describe('ModelConfig', () => {
  it('should load user config from ~/.oss/config.json', async () => {
    const config = new ModelConfig();
    const settings = await config.loadUserConfig();
    expect(settings.models).toBeDefined();
  });

  it('should load project config from .oss/config.json', async () => {
    const config = new ModelConfig();
    const settings = await config.loadProjectConfig('/path/to/project');
    expect(settings).toBeDefined();
  });

  it('should merge configs with correct precedence', async () => {
    // User: { agents: { "oss:code-reviewer": "gemini" } }
    // Project: { agents: { "oss:code-reviewer": "ollama" } }
    // Result: Project wins (more specific)
    const config = new ModelConfig();
    const merged = await config.getMergedConfig('/path');
    expect(merged.agents['oss:code-reviewer']).toBe('ollama');
  });

  it('should validate API keys exist for configured providers', async () => {
    const config = new ModelConfig();
    const validation = await config.validateConfig();
    expect(validation.missingKeys).toEqual([]);
  });
});
```

**Acceptance Criteria**:
- [ ] Load user config (`~/.oss/config.json`)
- [ ] Load project config (`.oss/config.json`)
- [ ] Merge with precedence: Project > User > Default
- [ ] Validate required API keys

---

### Task 1.3: Frontmatter Parser
**File**: `watcher/src/services/frontmatter-parser.ts`

```typescript
// Test first: services/frontmatter-parser.test.ts
describe('FrontmatterParser', () => {
  it('should extract model from prompt frontmatter', () => {
    const content = `---
name: code-reviewer
model: openrouter/deepseek/deepseek-chat
model_fallback: true
---
# Code Reviewer`;

    const parsed = parseFrontmatter(content);
    expect(parsed.model).toBe('openrouter/deepseek/deepseek-chat');
    expect(parsed.model_fallback).toBe(true);
  });

  it('should return undefined for prompts without model', () => {
    const content = `---
name: simple-agent
---
# Agent`;

    const parsed = parseFrontmatter(content);
    expect(parsed.model).toBeUndefined();
  });
});
```

**Acceptance Criteria**:
- [ ] Parse YAML frontmatter from markdown
- [ ] Extract `model` and `model_fallback` fields
- [ ] Handle missing frontmatter gracefully

---

## Phase 2: Model Router (Days 3-4)

### Task 2.1: Model Router Core
**File**: `watcher/src/services/model-router.ts`

```typescript
// Test first: services/model-router.test.ts
describe('ModelRouter', () => {
  it('should resolve model with CLI override taking precedence', async () => {
    const router = new ModelRouter();
    const model = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship',
      cliOverride: 'gemini/gemini-2.0-flash'
    });
    expect(model).toBe('gemini/gemini-2.0-flash');
  });

  it('should fall back through config precedence chain', async () => {
    // No CLI, no user config, project config has it
    const router = new ModelRouter();
    mockProjectConfig({ commands: { 'oss:ship': 'ollama/llama3.2' } });

    const model = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship'
    });
    expect(model).toBe('ollama/llama3.2');
  });

  it('should return default when no config found', async () => {
    const router = new ModelRouter();
    const model = await router.resolveModel({
      promptType: 'agent',
      promptName: 'oss:unknown-agent'
    });
    expect(model).toBe('default');
  });

  it('should check frontmatter when no config matches', async () => {
    const router = new ModelRouter();
    mockFrontmatter('agents/code-reviewer.md', { model: 'openai/gpt-4o' });

    const model = await router.resolveModel({
      promptType: 'agent',
      promptName: 'oss:code-reviewer'
    });
    expect(model).toBe('openai/gpt-4o');
  });
});
```

**Acceptance Criteria**:
- [ ] Resolve model following precedence chain
- [ ] CLI > User Settings > Project Config > Frontmatter > Default
- [ ] Cache resolved models for performance
- [ ] Invalidate cache on config change

---

### Task 2.2: Provider Detection
**File**: `watcher/src/services/provider-detector.ts`

```typescript
// Test first: services/provider-detector.test.ts
describe('ProviderDetector', () => {
  it('should detect OpenRouter models', () => {
    expect(detectProvider('openrouter/deepseek/chat')).toBe('openrouter');
    expect(detectProvider('openrouter/anthropic/claude-3.5-sonnet')).toBe('openrouter');
  });

  it('should detect Ollama models', () => {
    expect(detectProvider('ollama/codellama')).toBe('ollama');
    expect(detectProvider('ollama/llama3.2')).toBe('ollama');
  });

  it('should detect OpenAI models', () => {
    expect(detectProvider('openai/gpt-4o')).toBe('openai');
    expect(detectProvider('openai/o1')).toBe('openai');
  });

  it('should detect Gemini models', () => {
    expect(detectProvider('gemini/gemini-2.0-flash')).toBe('gemini');
  });

  it('should return claude for default/native', () => {
    expect(detectProvider('default')).toBe('claude');
    expect(detectProvider('claude')).toBe('claude');
  });
});
```

**Acceptance Criteria**:
- [ ] Parse provider from model identifier
- [ ] Handle all supported providers
- [ ] Validate model format

---

## Phase 3: API Transformer (Days 5-7)

### Task 3.1: Anthropic to OpenAI Transform
**File**: `watcher/src/services/api-transformer.ts`

```typescript
// Test first: services/api-transformer.test.ts
describe('ApiTransformer - Anthropic to OpenAI', () => {
  it('should transform message format', () => {
    const anthropicRequest = {
      model: 'claude-3-opus',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024
    };

    const openaiRequest = transformToOpenAI(anthropicRequest);
    expect(openaiRequest.messages[0].role).toBe('user');
    expect(openaiRequest.messages[0].content).toBe('Hello');
  });

  it('should transform tool_use to function_call', () => {
    const anthropicRequest = {
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool_1',
          name: 'get_weather',
          input: { city: 'London' }
        }]
      }]
    };

    const openaiRequest = transformToOpenAI(anthropicRequest);
    expect(openaiRequest.messages[0].tool_calls[0].function.name).toBe('get_weather');
  });

  it('should drop anthropic-specific parameters', () => {
    const anthropicRequest = {
      model: 'claude-3-opus',
      messages: [],
      metadata: { user_id: 'xxx' }  // Anthropic-specific
    };

    const openaiRequest = transformToOpenAI(anthropicRequest);
    expect(openaiRequest.metadata).toBeUndefined();
  });
});
```

**Acceptance Criteria**:
- [ ] Transform message roles correctly
- [ ] Convert tool_use ↔ function_call
- [ ] Drop incompatible parameters
- [ ] Handle streaming format

---

### Task 3.2: OpenAI to Anthropic Response Transform
**File**: `watcher/src/services/api-transformer.ts`

```typescript
// Test first: continuing api-transformer.test.ts
describe('ApiTransformer - OpenAI to Anthropic Response', () => {
  it('should transform response format', () => {
    const openaiResponse = {
      choices: [{
        message: { role: 'assistant', content: 'Hello!' }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    };

    const anthropicResponse = transformFromOpenAI(openaiResponse);
    expect(anthropicResponse.content[0].text).toBe('Hello!');
    expect(anthropicResponse.usage.input_tokens).toBe(10);
    expect(anthropicResponse.usage.output_tokens).toBe(5);
  });

  it('should transform function_call to tool_use', () => {
    const openaiResponse = {
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call_1',
            function: { name: 'search', arguments: '{"q":"test"}' }
          }]
        }
      }]
    };

    const anthropicResponse = transformFromOpenAI(openaiResponse);
    expect(anthropicResponse.content[0].type).toBe('tool_use');
    expect(anthropicResponse.content[0].name).toBe('search');
  });

  it('should handle streaming SSE chunks', () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"Hi"}}]}';
    const transformed = transformStreamChunk(chunk);
    expect(transformed).toContain('"type":"content_block_delta"');
  });
});
```

**Acceptance Criteria**:
- [ ] Transform response structure
- [ ] Convert usage tokens
- [ ] Handle streaming chunks
- [ ] Convert function calls to tool_use

---

### Task 3.3: Gemini-Specific Transform
**File**: `watcher/src/services/gemini-transformer.ts`

```typescript
// Test first: services/gemini-transformer.test.ts
describe('GeminiTransformer', () => {
  it('should transform to Gemini generateContent format', () => {
    const anthropicRequest = {
      model: 'claude-3-opus',
      messages: [{ role: 'user', content: 'Hello' }]
    };

    const geminiRequest = transformToGemini(anthropicRequest);
    expect(geminiRequest.contents[0].role).toBe('user');
    expect(geminiRequest.contents[0].parts[0].text).toBe('Hello');
  });

  it('should handle system prompts as first user message', () => {
    const anthropicRequest = {
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }]
    };

    const geminiRequest = transformToGemini(anthropicRequest);
    expect(geminiRequest.systemInstruction.parts[0].text).toBe('You are helpful');
  });
});
```

**Acceptance Criteria**:
- [ ] Transform to Gemini API format
- [ ] Handle system prompts
- [ ] Convert tool definitions
- [ ] Handle multimodal content

---

## Phase 4: Model Proxy Server (Days 8-10)

### Task 4.1: Proxy Server Core
**File**: `watcher/src/services/model-proxy.ts`

```typescript
// Test first: services/model-proxy.test.ts
describe('ModelProxy', () => {
  it('should start on available port', async () => {
    const proxy = new ModelProxy({ provider: 'openrouter' });
    await proxy.start();

    expect(proxy.isRunning()).toBe(true);
    expect(proxy.getPort()).toBeGreaterThan(0);

    await proxy.shutdown();
  });

  it('should route /v1/messages to provider', async () => {
    const proxy = new ModelProxy({ provider: 'openrouter' });
    await proxy.start();

    const response = await fetch(`http://localhost:${proxy.getPort()}/v1/messages`, {
      method: 'POST',
      body: JSON.stringify({ model: 'test', messages: [] })
    });

    expect(response.status).toBe(200);
    await proxy.shutdown();
  });

  it('should shutdown cleanly', async () => {
    const proxy = new ModelProxy({ provider: 'openrouter' });
    await proxy.start();
    const port = proxy.getPort();

    await proxy.shutdown();

    expect(proxy.isRunning()).toBe(false);
    // Port should be free
  });
});
```

**Acceptance Criteria**:
- [ ] Start on available port
- [ ] Route requests to provider handlers
- [ ] Clean shutdown with connection cleanup
- [ ] Bind to localhost only

---

### Task 4.2: Provider Handlers
**File**: `watcher/src/services/handlers/*.ts`

```typescript
// Test first: services/handlers/openrouter-handler.test.ts
describe('OpenRouterHandler', () => {
  it('should forward requests to OpenRouter API', async () => {
    const handler = new OpenRouterHandler({ apiKey: 'test-key' });

    const request = {
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    };

    const response = await handler.handle(request);
    expect(response.content).toBeDefined();
  });

  it('should include authorization header', async () => {
    const handler = new OpenRouterHandler({ apiKey: 'sk-or-xxx' });
    const headers = handler.getHeaders();

    expect(headers['Authorization']).toBe('Bearer sk-or-xxx');
  });
});

// Test first: services/handlers/ollama-handler.test.ts
describe('OllamaHandler', () => {
  it('should connect to local Ollama server', async () => {
    const handler = new OllamaHandler({ baseUrl: 'http://localhost:11434' });

    const response = await handler.handle({
      model: 'codellama',
      messages: [{ role: 'user', content: 'Hello' }]
    });

    expect(response.content).toBeDefined();
  });

  it('should detect Ollama not running', async () => {
    const handler = new OllamaHandler({ baseUrl: 'http://localhost:99999' });

    await expect(handler.handle({})).rejects.toThrow(/Ollama not running/);
  });
});
```

**Acceptance Criteria**:
- [ ] OpenRouterHandler with API key auth
- [ ] OllamaHandler for local models
- [ ] OpenAIHandler for direct OpenAI
- [ ] GeminiHandler for Google AI

---

### Task 4.3: Streaming Support
**File**: `watcher/src/services/stream-transformer.ts`

```typescript
// Test first: services/stream-transformer.test.ts
describe('StreamTransformer', () => {
  it('should transform OpenAI SSE to Anthropic SSE', async () => {
    const openaiChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]'
    ];

    const transformer = new StreamTransformer('openai');
    const anthropicChunks = [];

    for (const chunk of openaiChunks) {
      const transformed = transformer.transform(chunk);
      if (transformed) anthropicChunks.push(transformed);
    }

    expect(anthropicChunks[0]).toContain('content_block_delta');
    expect(anthropicChunks[0]).toContain('Hello');
  });

  it('should handle partial chunks', () => {
    const transformer = new StreamTransformer('openai');

    // Chunk split mid-JSON
    const partial1 = 'data: {"choices":[{"del';
    const partial2 = 'ta":{"content":"Hi"}}]}';

    expect(transformer.transform(partial1)).toBeNull();
    expect(transformer.transform(partial2)).toContain('Hi');
  });
});
```

**Acceptance Criteria**:
- [ ] Transform SSE format between providers
- [ ] Buffer partial chunks
- [ ] Handle stream end markers
- [ ] Maintain event ordering

---

## Phase 5: Command Integration (Days 11-12)

### Task 5.1: /oss:models Command
**File**: `watcher/src/cli/models.ts`

```typescript
// Test first: cli/models.test.ts
describe('/oss:models Command', () => {
  describe('list', () => {
    it('should list available models grouped by provider', async () => {
      const output = await executeModelsCommand(['list']);

      expect(output).toContain('OpenRouter');
      expect(output).toContain('Ollama');
      expect(output).toContain('OpenAI');
      expect(output).toContain('Gemini');
    });
  });

  describe('search', () => {
    it('should filter models by query', async () => {
      const output = await executeModelsCommand(['search', 'code']);

      expect(output).toContain('codellama');
      expect(output).toContain('deepseek-coder');
    });

    it('should show free models with --free flag', async () => {
      const output = await executeModelsCommand(['search', '--free']);

      expect(output).not.toContain('gpt-4o');  // Not free
      expect(output).toContain('llama');  // Free via Ollama
    });
  });

  describe('set', () => {
    it('should update model config for prompt', async () => {
      await executeModelsCommand(['set', 'oss:code-reviewer', 'ollama/codellama']);

      const config = await loadUserConfig();
      expect(config.models.agents['oss:code-reviewer']).toBe('ollama/codellama');
    });
  });

  describe('test', () => {
    it('should verify model connectivity', async () => {
      const output = await executeModelsCommand(['test', 'ollama/llama3.2']);

      expect(output).toContain('✓');  // Success indicator
    });

    it('should report failure for invalid model', async () => {
      const output = await executeModelsCommand(['test', 'invalid/model']);

      expect(output).toContain('✗');  // Failure indicator
    });
  });
});
```

**Acceptance Criteria**:
- [ ] `list` - Show available models
- [ ] `search <query>` - Filter models
- [ ] `config` - Show current configuration
- [ ] `set <prompt> <model>` - Configure model
- [ ] `test <model>` - Verify connectivity
- [ ] `costs` - Show usage costs
- [ ] `keys set <provider> <key>` - Configure API key

---

### Task 5.2: CLI Override Support
**File**: Modify existing command handlers

```typescript
// Test first: cli/command-override.test.ts
describe('CLI Model Override', () => {
  it('should parse --model flag from command', () => {
    const args = parseCommandArgs('/oss:ship --model gemini/gemini-2.0-flash');

    expect(args.model).toBe('gemini/gemini-2.0-flash');
    expect(args.command).toBe('oss:ship');
  });

  it('should pass model override to router', async () => {
    const router = new ModelRouter();
    vi.spyOn(router, 'resolveModel');

    await executeCommand('/oss:ship --model ollama/llama3.2');

    expect(router.resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({ cliOverride: 'ollama/llama3.2' })
    );
  });
});
```

**Acceptance Criteria**:
- [ ] Parse `--model` flag from any command
- [ ] Pass override to ModelRouter
- [ ] Show active model in output

---

## Phase 6: Cost Tracking (Days 13-14)

### Task 6.1: Cost Tracker
**File**: `watcher/src/services/cost-tracker.ts`

```typescript
// Test first: services/cost-tracker.test.ts
describe('CostTracker', () => {
  it('should track tokens per request', async () => {
    const tracker = new CostTracker();

    tracker.recordUsage({
      command: 'oss:ship',
      model: 'openrouter/deepseek/chat',
      inputTokens: 1000,
      outputTokens: 500
    });

    const usage = await tracker.getUsage('2024-01-12');
    expect(usage['oss:ship'].tokens).toBe(1500);
  });

  it('should calculate cost based on model pricing', async () => {
    const tracker = new CostTracker();

    tracker.recordUsage({
      command: 'oss:review',
      model: 'openai/gpt-4o',
      inputTokens: 10000,
      outputTokens: 2000
    });

    const usage = await tracker.getUsage('2024-01-12');
    // GPT-4o: $2.50/1M input, $10/1M output
    expect(usage['oss:review'].cost_usd).toBeCloseTo(0.045, 3);
  });

  it('should persist usage to file', async () => {
    const tracker = new CostTracker();
    tracker.recordUsage({ command: 'test', model: 'test', inputTokens: 100, outputTokens: 50 });

    await tracker.flush();

    const data = await fs.readFile('~/.oss/usage.json', 'utf8');
    expect(JSON.parse(data)).toHaveProperty('2024-01-12');
  });

  it('should aggregate by day and command', async () => {
    const tracker = new CostTracker();

    tracker.recordUsage({ command: 'oss:ship', model: 'test', inputTokens: 100, outputTokens: 50 });
    tracker.recordUsage({ command: 'oss:ship', model: 'test', inputTokens: 200, outputTokens: 100 });

    const usage = await tracker.getUsage('2024-01-12');
    expect(usage['oss:ship'].tokens).toBe(450);  // Aggregated
  });
});
```

**Acceptance Criteria**:
- [ ] Track tokens per request
- [ ] Calculate cost from model pricing
- [ ] Persist to `~/.oss/usage.json`
- [ ] Aggregate by day and command

---

### Task 6.2: Model Registry with Pricing
**File**: `watcher/src/services/model-registry.ts`

```typescript
// Test first: services/model-registry.test.ts
describe('ModelRegistry', () => {
  it('should return pricing for known models', () => {
    const registry = new ModelRegistry();

    const pricing = registry.getPricing('openai/gpt-4o');
    expect(pricing.inputPer1M).toBe(2.50);
    expect(pricing.outputPer1M).toBe(10.00);
  });

  it('should return zero cost for local models', () => {
    const registry = new ModelRegistry();

    const pricing = registry.getPricing('ollama/codellama');
    expect(pricing.inputPer1M).toBe(0);
    expect(pricing.outputPer1M).toBe(0);
  });

  it('should list models by provider', () => {
    const registry = new ModelRegistry();

    const openrouterModels = registry.listModels('openrouter');
    expect(openrouterModels.length).toBeGreaterThan(10);
  });

  it('should search models by capability', () => {
    const registry = new ModelRegistry();

    const codeModels = registry.searchModels('code');
    expect(codeModels.some(m => m.id.includes('codellama'))).toBe(true);
  });
});
```

**Acceptance Criteria**:
- [ ] Store model metadata (pricing, capabilities)
- [ ] Fetch OpenRouter model list
- [ ] Search by name/capability
- [ ] Mark free models

---

## Phase 7: Fallback & Error Handling (Day 15)

### Task 7.1: Fallback Logic
**File**: `watcher/src/services/model-executor.ts`

```typescript
// Test first: services/model-executor.test.ts
describe('ModelExecutor', () => {
  it('should execute with native Claude when model is default', async () => {
    const executor = new ModelExecutor();

    const result = await executor.execute({
      prompt: 'Test prompt',
      model: 'default'
    });

    expect(result.provider).toBe('claude');
  });

  it('should use proxy for non-Claude models', async () => {
    const executor = new ModelExecutor();

    const result = await executor.execute({
      prompt: 'Test prompt',
      model: 'ollama/codellama'
    });

    expect(result.provider).toBe('ollama');
  });

  it('should fallback to Claude on model failure', async () => {
    const executor = new ModelExecutor();
    mockProviderFailure('openrouter');

    const result = await executor.execute({
      prompt: 'Test prompt',
      model: 'openrouter/invalid-model',
      fallbackEnabled: true
    });

    expect(result.provider).toBe('claude');
    expect(result.fallbackUsed).toBe(true);
  });

  it('should notify user on fallback', async () => {
    const executor = new ModelExecutor();
    const notify = vi.fn();
    executor.onFallback(notify);

    mockProviderFailure('gemini');
    await executor.execute({ model: 'gemini/test', fallbackEnabled: true });

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('falling back to Claude')
    );
  });

  it('should throw when fallback disabled and model fails', async () => {
    const executor = new ModelExecutor();
    mockProviderFailure('openai');

    await expect(executor.execute({
      model: 'openai/gpt-4o',
      fallbackEnabled: false
    })).rejects.toThrow();
  });
});
```

**Acceptance Criteria**:
- [ ] Execute native for default/claude
- [ ] Route through proxy for other models
- [ ] Fallback on failure when enabled
- [ ] Notify user on fallback
- [ ] Respect `fallbackEnabled` flag

---

## Phase 8: Settings Integration (Day 16)

### Task 8.1: Extend Settings Service
**File**: Modify `watcher/src/services/settings.ts`

```typescript
// Test first: services/settings-models.test.ts
describe('Settings - Model Configuration', () => {
  it('should get model config for prompt', async () => {
    const settings = new SettingsService();
    await settings.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');

    const model = await settings.getModelForPrompt('agent', 'oss:code-reviewer');
    expect(model).toBe('ollama/codellama');
  });

  it('should list all configured models', async () => {
    const settings = new SettingsService();

    const models = await settings.getModelConfig();
    expect(models.agents).toBeDefined();
    expect(models.commands).toBeDefined();
    expect(models.skills).toBeDefined();
    expect(models.hooks).toBeDefined();
  });

  it('should store API keys securely', async () => {
    const settings = new SettingsService();
    await settings.setApiKey('openrouter', 'sk-or-xxx');

    const key = await settings.getApiKey('openrouter');
    expect(key).toBe('sk-or-xxx');
  });

  it('should prefer env vars over stored keys', async () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    const settings = new SettingsService();
    await settings.setApiKey('openrouter', 'stored-key');

    const key = await settings.getApiKey('openrouter');
    expect(key).toBe('env-key');

    delete process.env.OPENROUTER_API_KEY;
  });
});
```

**Acceptance Criteria**:
- [ ] Add model config to settings schema
- [ ] CRUD for model assignments
- [ ] API key storage
- [ ] Environment variable override

---

## Phase 9: Documentation & Polish (Days 17-18)

### Task 9.1: Command Prompt File
**File**: `commands/models.md`

Create the `/oss:models` command prompt with all subcommands documented.

### Task 9.2: Update CLAUDE.md
Add model configuration documentation to project guidelines.

### Task 9.3: Example Configurations
Create example presets in `examples/model-configs/`.

---

## Phase 10: Integration Testing (Days 19-20)

### Task 10.1: E2E Tests
**File**: `watcher/test/e2e/model-routing.test.ts`

```typescript
describe('E2E: Model Routing', () => {
  it('should execute command with configured model', async () => {
    // Configure ollama for code-reviewer
    await executeCommand('/oss:models set oss:code-reviewer ollama/codellama');

    // Run code-reviewer (should use ollama)
    const result = await executeCommand('/oss:review');

    expect(result.modelUsed).toBe('ollama/codellama');
  });

  it('should fallback when Ollama not running', async () => {
    await stopOllama();

    const result = await executeCommand('/oss:review');

    expect(result.fallbackUsed).toBe(true);
    expect(result.modelUsed).toBe('claude');

    await startOllama();
  });

  it('should track costs across session', async () => {
    await executeCommand('/oss:ship --model openrouter/deepseek/chat');
    await executeCommand('/oss:plan --model gemini/gemini-2.0-flash');

    const costs = await executeCommand('/oss:models costs');

    expect(costs).toContain('oss:ship');
    expect(costs).toContain('oss:plan');
  });
});
```

---

## Task Summary

| Phase | Tasks | Tests | Est. Duration |
|-------|-------|-------|---------------|
| 1. Core Types & Config | 3 | 15 | 2 days |
| 2. Model Router | 2 | 12 | 2 days |
| 3. API Transformer | 3 | 18 | 3 days |
| 4. Model Proxy | 3 | 15 | 3 days |
| 5. Command Integration | 2 | 12 | 2 days |
| 6. Cost Tracking | 2 | 10 | 2 days |
| 7. Fallback & Error | 1 | 8 | 1 day |
| 8. Settings Integration | 1 | 6 | 1 day |
| 9. Documentation | 3 | - | 2 days |
| 10. Integration Testing | 1 | 6 | 2 days |
| **Total** | **21** | **102** | **20 days** |

---

## Dependencies

### External Packages
```json
{
  "hono": "^4.10.6",
  "@hono/node-server": "^1.19.6",
  "undici": "^7.16.0",
  "yaml": "^2.3.4"
}
```

### Dev Dependencies
```json
{
  "msw": "^2.0.0"  // For mocking provider APIs in tests
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Claude Code API changes | Abstract behind transformer layer |
| Provider API differences | Comprehensive test coverage per provider |
| Streaming complexity | Dedicated StreamTransformer with buffer tests |
| Token counting accuracy | Use provider-specific tokenizers when available |

---

## Definition of Done

- [ ] All 102 tests passing
- [ ] Build succeeds without errors
- [ ] `/oss:models` command working
- [ ] At least 2 providers tested E2E (OpenRouter, Ollama)
- [ ] Cost tracking persisting correctly
- [ ] Fallback working reliably
- [ ] Documentation complete

---

*Plan approved: Ready for /oss:build*
